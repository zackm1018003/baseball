// Blog post storage using Vercel Blob.
// All posts live in a single JSON blob at baseball-blog/posts.json.

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  content: string; // markdown
  excerpt: string;
  coverImageUrl?: string; // optional hero image URL
  published: boolean;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

const BLOB_PATH = 'baseball-blog/posts.json';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

async function getBlobUrl(): Promise<string | null> {
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'baseball-blog/posts' });
    return blobs[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function readAll(): Promise<BlogPost[]> {
  const url = await getBlobUrl();
  if (!url) return [];
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json() as BlogPost[];
  } catch {
    return [];
  }
}

async function writeAll(posts: BlogPost[]): Promise<void> {
  const { put } = await import('@vercel/blob');
  await put(BLOB_PATH, JSON.stringify(posts), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export async function listPosts(publishedOnly = true): Promise<BlogPost[]> {
  const posts = await readAll();
  const filtered = publishedOnly ? posts.filter(p => p.published) : posts;
  return filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const posts = await readAll();
  return posts.find(p => p.slug === slug || p.id === slug) ?? null;
}

export async function createPost(
  data: Pick<BlogPost, 'title' | 'content' | 'excerpt' | 'published' | 'tags'>
): Promise<BlogPost> {
  const posts = await readAll();
  const now = new Date().toISOString();
  const base = slugify(data.title);
  let slug = base;
  let n = 1;
  while (posts.some(p => p.slug === slug)) slug = `${base}-${n++}`;
  const post: BlogPost = {
    ...data,
    id: crypto.randomUUID(),
    slug,
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...posts, post]);
  return post;
}

export async function updatePost(
  id: string,
  data: Partial<Omit<BlogPost, 'id' | 'createdAt'>>
): Promise<BlogPost | null> {
  const posts = await readAll();
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  posts[idx] = { ...posts[idx], ...data, updatedAt: new Date().toISOString() };
  await writeAll(posts);
  return posts[idx];
}

export async function deletePost(id: string): Promise<boolean> {
  const posts = await readAll();
  const filtered = posts.filter(p => p.id !== id);
  if (filtered.length === posts.length) return false;
  await writeAll(filtered);
  return true;
}

// Lightweight markdown → HTML (no extra packages)
export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Heading
    if (/^### /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${fmt(line.slice(4))}</h3>`);
      continue;
    }
    if (/^## /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${fmt(line.slice(3))}</h2>`);
      continue;
    }
    if (/^# /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${fmt(line.slice(2))}</h1>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<hr />');
      continue;
    }

    // Blockquote
    if (/^> /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<blockquote>${fmt(line.slice(2))}</blockquote>`);
      continue;
    }

    // List item
    if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${fmt(line.slice(2))}</li>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
      continue;
    }

    // Paragraph
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p>${fmt(line)}</p>`);
  }

  if (inList) out.push('</ul>');
  return out.join('\n');
}

function fmt(s: string): string {
  return s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function checkAdminKey(req: Request): boolean {
  const key = process.env.BLOG_ADMIN_KEY;
  if (!key) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${key}`;
}
