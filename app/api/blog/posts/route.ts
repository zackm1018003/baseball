import { NextRequest, NextResponse } from 'next/server';
import { listPosts, createPost, checkAdminKey } from '@/lib/blog';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const isAdmin = checkAdminKey(req);
  try {
    const posts = await listPosts(!isAdmin);
    return NextResponse.json(posts);
  } catch (e) {
    console.error('[blog] GET /posts failed:', e);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { title, content, excerpt, published, tags } = body;
    if (!title || !content) {
      return NextResponse.json({ error: 'title and content are required' }, { status: 400 });
    }
    const post = await createPost({
      title: String(title),
      content: String(content),
      excerpt: String(excerpt ?? ''),
      published: Boolean(published),
      tags: Array.isArray(tags) ? tags.map(String) : [],
    });
    return NextResponse.json(post, { status: 201 });
  } catch (e) {
    console.error('[blog] POST /posts failed:', e);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}
