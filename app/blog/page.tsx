import Link from 'next/link';
import { listPosts } from '@/lib/blog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Blog – Stat DB' };

export default async function BlogPage() {
  let posts: Awaited<ReturnType<typeof listPosts>> = [];
  try { posts = await listPosts(true); } catch { /* blob not configured yet */ }

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="bg-deep border-b border-line px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-ink-4 hover:text-ink text-sm transition-colors">← Home</Link>
          <h1 className="font-display text-2xl uppercase tracking-wide text-accent">Field Notes</h1>
        </div>
        <Link href="/blog/admin" className="text-ink-4 hover:text-ink text-xs transition-colors">Admin</Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {posts.length === 0 ? (
          <div className="text-ink-4 text-center py-20 text-sm">No posts yet.</div>
        ) : (
          <div className="flex flex-col gap-8">
            {posts.map(post => (
              <article key={post.id} className="border-b border-line pb-8">
                <div className="flex items-center gap-3 mb-2">
                  <time className="text-ink-4 text-xs font-mono">
                    {new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </time>
                  {post.tags.map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-px bg-bone text-ink-3 uppercase tracking-wide">{tag}</span>
                  ))}
                </div>
                <Link href={`/blog/${post.slug}`} className="group">
                  <h2 className="font-display text-2xl uppercase tracking-wide text-ink group-hover:text-accent transition-colors mb-2">
                    {post.title}
                  </h2>
                </Link>
                {post.excerpt && (
                  <p className="text-ink-3 text-sm leading-relaxed mb-3">{post.excerpt}</p>
                )}
                <Link href={`/blog/${post.slug}`} className="text-accent text-xs font-semibold hover:underline">
                  Read more →
                </Link>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
