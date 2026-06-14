'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  coverImageUrl?: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

type Mode = 'login' | 'list' | 'editor';

const STORAGE_KEY = 'blog-admin-key';

function authHeaders(key: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

// ── Editor ────────────────────────────────────────────────────────────────────

function Editor({
  initial,
  onSave,
  onCancel,
  adminKey,
}: {
  initial: Partial<BlogPost> | null;
  onSave: (post: BlogPost) => void;
  onCancel: () => void;
  adminKey: string;
}) {
  const [title, setTitle]         = useState(initial?.title ?? '');
  const [content, setContent]     = useState(initial?.content ?? '');
  const [excerpt, setExcerpt]     = useState(initial?.excerpt ?? '');
  const [coverImageUrl, setCover] = useState(initial?.coverImageUrl ?? '');
  const [tags, setTags]           = useState((initial?.tags ?? []).join(', '));
  const [preview, setPreview]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const save = async (publish: boolean) => {
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const tagsArr = tags.split(',').map(t => t.trim()).filter(Boolean);
      const body = {
        title: title.trim(), content, excerpt: excerpt.trim(),
        coverImageUrl: coverImageUrl.trim() || undefined,
        tags: tagsArr, published: publish,
      };
      let res: Response;
      if (initial?.id) {
        res = await fetch(`/api/blog/posts/${initial.id}`, {
          method: 'PUT', headers: authHeaders(adminKey), body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/blog/posts', {
          method: 'POST', headers: authHeaders(adminKey), body: JSON.stringify(body),
        });
      }
      if (!res.ok) { setError(`Save failed (${res.status})`); return; }
      const saved: BlogPost = await res.json();
      onSave(saved);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl uppercase tracking-wide text-accent">
          {initial?.id ? 'Edit Post' : 'New Post'}
        </h2>
        <button onClick={onCancel} className="text-ink-4 hover:text-ink text-sm transition-colors">← Back</button>
      </div>

      {error && <p className="text-red-400 text-xs bg-bone p-2">{error}</p>}

      <div className="flex flex-col gap-1">
        <label className="text-ink-4 text-[10px] uppercase tracking-widest">Title</label>
        <input
          value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Post title…"
          className="bg-bone border border-line text-ink text-sm px-3 py-2 outline-none focus:border-accent transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-ink-4 text-[10px] uppercase tracking-widest">Excerpt / Subtitle</label>
        <input
          value={excerpt} onChange={e => setExcerpt(e.target.value)}
          placeholder="One-line summary shown in the post list…"
          className="bg-bone border border-line text-ink text-sm px-3 py-2 outline-none focus:border-accent transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-ink-4 text-[10px] uppercase tracking-widest">Cover Image URL <span className="normal-case opacity-60">(optional)</span></label>
        <div className="flex gap-2 items-start">
          <input
            value={coverImageUrl} onChange={e => setCover(e.target.value)}
            placeholder="https://img.mlbstatic.com/… or any image URL"
            className="flex-1 bg-bone border border-line text-ink text-sm px-3 py-2 outline-none focus:border-accent transition-colors"
          />
          {coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImageUrl} alt="cover preview"
              className="w-20 h-12 object-cover object-top border border-line flex-shrink-0" />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-ink-4 text-[10px] uppercase tracking-widest">Tags (comma-separated)</label>
        <input
          value={tags} onChange={e => setTags(e.target.value)}
          placeholder="prospect, pitcher, AAA…"
          className="bg-bone border border-line text-ink text-sm px-3 py-2 outline-none focus:border-accent transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1 flex-1">
        <div className="flex items-center justify-between mb-1">
          <label className="text-ink-4 text-[10px] uppercase tracking-widest">Content (Markdown)</label>
          <button
            onClick={() => setPreview(p => !p)}
            className="text-[10px] text-ink-4 hover:text-ink uppercase tracking-widest transition-colors"
          >
            {preview ? '✎ Edit' : '◎ Preview'}
          </button>
        </div>
        {preview ? (
          <div
            className="prose-blog bg-bone border border-line p-4 min-h-64 overflow-auto"
            dangerouslySetInnerHTML={{ __html: renderClientMarkdown(content) }}
          />
        ) : (
          <textarea
            value={content} onChange={e => setContent(e.target.value)}
            placeholder={'## Heading\n\nStart writing your analysis...\n\n- Bullet points work\n- **Bold** and *italic* supported\n\n> Blockquotes for quotes or pull quotes'}
            rows={20}
            className="bg-bone border border-line text-ink text-sm font-mono px-3 py-2 outline-none focus:border-accent transition-colors resize-y leading-relaxed"
          />
        )}
      </div>

      <div className="flex gap-3 mt-2">
        <button
          onClick={() => save(false)} disabled={saving}
          className="px-4 py-2 text-xs font-bold uppercase tracking-wide bg-bone border border-line text-ink-2 hover:text-ink hover:border-ink-4 transition-colors disabled:opacity-50"
        >
          {saving ? '…' : 'Save Draft'}
        </button>
        <button
          onClick={() => save(true)} disabled={saving}
          className="px-4 py-2 text-xs font-bold uppercase tracking-wide bg-accent text-white hover:bg-red-600 transition-colors disabled:opacity-50"
        >
          {saving ? '…' : (initial?.published ? 'Update & Publish' : 'Publish')}
        </button>
      </div>
    </div>
  );
}

// ── Post list row ─────────────────────────────────────────────────────────────

function PostRow({
  post, adminKey, onEdit, onToggle, onDelete,
}: {
  post: BlogPost;
  adminKey: string;
  onEdit: (post: BlogPost) => void;
  onToggle: (post: BlogPost) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${post.title}"?`)) return;
    setDeleting(true);
    await fetch(`/api/blog/posts/${post.id}`, { method: 'DELETE', headers: authHeaders(adminKey) });
    onDelete(post.id);
  };

  const handleToggle = async () => {
    setToggling(true);
    const res = await fetch(`/api/blog/posts/${post.id}`, {
      method: 'PUT',
      headers: authHeaders(adminKey),
      body: JSON.stringify({ published: !post.published }),
    });
    if (res.ok) { const updated: BlogPost = await res.json(); onToggle(updated); }
    setToggling(false);
  };

  return (
    <div className="flex items-center gap-3 py-3 border-b border-line last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[9px] px-1.5 py-px font-bold uppercase tracking-widest ${post.published ? 'bg-green-900 text-green-300' : 'bg-bone text-ink-4'}`}>
            {post.published ? 'Live' : 'Draft'}
          </span>
          <span className="text-ink-4 text-[10px] font-mono">
            {new Date(post.updatedAt).toLocaleDateString()}
          </span>
          {post.tags.map(t => (
            <span key={t} className="text-[9px] text-ink-4 bg-bone px-1">{t}</span>
          ))}
        </div>
        <p className="text-sm font-semibold text-ink truncate">{post.title}</p>
        {post.excerpt && <p className="text-xs text-ink-4 truncate">{post.excerpt}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {post.published && (
          <Link href={`/blog/${post.slug}`} target="_blank"
            className="text-[10px] text-ink-4 hover:text-ink uppercase tracking-widest transition-colors">
            View
          </Link>
        )}
        <button onClick={() => onEdit(post)}
          className="text-[10px] text-ink-4 hover:text-ink uppercase tracking-widest transition-colors">
          Edit
        </button>
        <button onClick={handleToggle} disabled={toggling}
          className={`text-[10px] uppercase tracking-widest transition-colors ${post.published ? 'text-yellow-500 hover:text-yellow-300' : 'text-green-500 hover:text-green-300'}`}>
          {toggling ? '…' : (post.published ? 'Unpublish' : 'Publish')}
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="text-[10px] text-red-500 hover:text-red-300 uppercase tracking-widest transition-colors">
          {deleting ? '…' : 'Del'}
        </button>
      </div>
    </div>
  );
}

// ── Main admin page ───────────────────────────────────────────────────────────

export default function BlogAdmin() {
  const [mode, setMode]       = useState<Mode>('login');
  const [adminKey, setAdminKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [posts, setPosts]     = useState<BlogPost[]>([]);
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginErr, setLoginErr] = useState('');

  const loadPosts = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/blog/posts', { headers: authHeaders(key) });
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) { setAdminKey(saved); setMode('list'); loadPosts(saved); }
  }, [loadPosts]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    const res = await fetch('/api/blog/posts', { headers: authHeaders(keyInput) });
    if (res.ok) {
      sessionStorage.setItem(STORAGE_KEY, keyInput);
      setAdminKey(keyInput);
      setPosts(await res.json());
      setMode('list');
    } else {
      setLoginErr('Incorrect password.');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setAdminKey(''); setMode('login'); setKeyInput('');
  };

  if (mode === 'login') return (
    <div className="min-h-screen bg-page text-ink flex items-center justify-center">
      <div className="bg-panel border border-line p-8 w-80">
        <h1 className="font-display text-2xl uppercase tracking-wide text-accent mb-6">Blog Admin</h1>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
            placeholder="Admin password…" autoFocus
            className="bg-bone border border-line text-ink text-sm px-3 py-2 outline-none focus:border-accent transition-colors"
          />
          {loginErr && <p className="text-red-400 text-xs">{loginErr}</p>}
          <button type="submit"
            className="px-4 py-2 text-xs font-bold uppercase tracking-wide bg-accent text-white hover:bg-red-600 transition-colors">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="bg-deep border-b border-line px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/blog" className="text-ink-4 hover:text-ink text-sm transition-colors">← Blog</Link>
          <h1 className="font-display text-2xl uppercase tracking-wide text-accent">Admin</h1>
        </div>
        <div className="flex items-center gap-4">
          {mode === 'list' && (
            <button onClick={() => { setEditing(null); setMode('editor'); }}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-accent text-white hover:bg-red-600 transition-colors">
              + New Post
            </button>
          )}
          <button onClick={handleLogout} className="text-ink-4 hover:text-ink text-xs uppercase tracking-widest transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {mode === 'list' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink-3 uppercase tracking-widest">
                {posts.length} post{posts.length !== 1 ? 's' : ''}
              </h2>
            </div>
            {loading ? (
              <p className="text-ink-4 text-sm">Loading…</p>
            ) : posts.length === 0 ? (
              <p className="text-ink-4 text-sm">No posts yet. Create one above.</p>
            ) : (
              <div className="bg-panel border border-line px-4">
                {posts.map(post => (
                  <PostRow
                    key={post.id} post={post} adminKey={adminKey}
                    onEdit={p => { setEditing(p); setMode('editor'); }}
                    onToggle={updated => setPosts(ps => ps.map(p => p.id === updated.id ? updated : p))}
                    onDelete={id => setPosts(ps => ps.filter(p => p.id !== id))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'editor' && (
          <div className="bg-panel border border-line p-6">
            <Editor
              initial={editing}
              adminKey={adminKey}
              onCancel={() => setMode('list')}
              onSave={saved => {
                setPosts(ps => {
                  const idx = ps.findIndex(p => p.id === saved.id);
                  return idx >= 0 ? ps.map(p => p.id === saved.id ? saved : p) : [saved, ...ps];
                });
                setMode('list');
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

// Client-side markdown renderer (mirrors lib/blog.ts renderMarkdown)
function renderClientMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (/^### /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3>${fmtInline(line.slice(4))}</h3>`); continue; }
    if (/^## /.test(line))  { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2>${fmtInline(line.slice(3))}</h2>`); continue; }
    if (/^# /.test(line))   { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h1>${fmtInline(line.slice(2))}</h1>`); continue; }
    if (/^---+$/.test(line.trim())) { if (inList) { out.push('</ul>'); inList = false; } out.push('<hr />'); continue; }
    if (/^> /.test(line))   { if (inList) { out.push('</ul>'); inList = false; } out.push(`<blockquote>${fmtInline(line.slice(2))}</blockquote>`); continue; }
    if (/^[-*] /.test(line)){ if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${fmtInline(line.slice(2))}</li>`); continue; }
    if (line.trim() === '')  { if (inList) { out.push('</ul>'); inList = false; } out.push(''); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p>${fmtInline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
function fmtInline(s: string): string {
  return s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
