import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPost, listPosts, renderMarkdown, type BlogPost } from '@/lib/blog';

export const dynamic = 'force-dynamic';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug).catch(() => null);
  if (!post || !post.published) notFound();

  // Sidebar: recent posts excluding this one
  let recent: BlogPost[] = [];
  try { recent = (await listPosts(true)).filter(p => p.id !== post.id).slice(0, 5); } catch { /* ok */ }

  const html = renderMarkdown(post.content);
  const date = new Date(post.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* ── Header ── */}
      <header className="bg-deep border-b border-line">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/blog" className="text-ink-4 hover:text-ink text-xs uppercase tracking-widest transition-colors">← Field Notes</Link>
          </div>
          <span className="font-display text-2xl font-black uppercase tracking-wide text-ink">Field Notes</span>
        </div>
        <div className="h-0.5 bg-accent w-full" />
      </header>

      {/* ── Hero image ── */}
      {post.coverImageUrl && (
        <div className="w-full max-h-96 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.coverImageUrl} alt={post.title}
            className="w-full max-h-96 object-cover object-top" />
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex gap-10">
          {/* ── Article ── */}
          <article className="flex-1 min-w-0">
            {/* Meta */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {post.tags.map(tag => (
                <span key={tag}
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 bg-accent/10 text-accent border border-accent/30">
                  {tag}
                </span>
              ))}
              <span className="text-ink-5 text-[11px] font-mono ml-1">{date}</span>
            </div>

            {/* Title */}
            <h1 className="font-display text-5xl font-black uppercase tracking-wide text-ink leading-tight mb-5">
              {post.title}
            </h1>

            {/* Excerpt / lede */}
            {post.excerpt && (
              <p className="text-ink-3 text-lg leading-relaxed border-l-2 border-accent pl-5 mb-8">
                {post.excerpt}
              </p>
            )}

            {/* Divider */}
            <div className="h-px bg-line mb-8" />

            {/* Body */}
            <div className="prose-blog" dangerouslySetInnerHTML={{ __html: html }} />

            {/* Footer nav */}
            <div className="mt-12 pt-6 border-t border-line">
              <Link href="/blog"
                className="text-xs font-bold uppercase tracking-widest text-accent hover:text-red-400 transition-colors">
                ← All Posts
              </Link>
            </div>
          </article>

          {/* ── Sidebar ── */}
          <aside className="w-64 flex-shrink-0 hidden lg:block">
            <div className="sticky top-6 flex flex-col gap-6">
              {recent.length > 0 && (
                <div className="bg-panel border border-line p-4">
                  <h3 className="font-display text-sm font-bold uppercase tracking-widest text-ink mb-3 pb-2 border-b border-line">
                    More Posts
                  </h3>
                  <div className="flex flex-col gap-3">
                    {recent.map(p => (
                      <Link key={p.id} href={`/blog/${p.slug}`} className="group flex flex-col gap-0.5">
                        {p.coverImageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.coverImageUrl} alt={p.title}
                            className="w-full h-20 object-cover object-top mb-1 opacity-80 group-hover:opacity-100 transition-opacity" />
                        )}
                        <span className="text-xs font-semibold text-ink group-hover:text-accent transition-colors leading-snug">
                          {p.title}
                        </span>
                        <span className="text-[10px] text-ink-5 font-mono">
                          {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-panel border border-line p-4">
                <h3 className="font-display text-sm font-bold uppercase tracking-widest text-ink mb-2 pb-2 border-b border-line">
                  About
                </h3>
                <p className="text-ink-4 text-xs leading-relaxed">
                  Prospect analysis, scouting reports, and notes from the field. Part of the{' '}
                  <Link href="/" className="text-accent hover:underline">MLB Stat DB</Link>.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-line mt-16 py-6 text-center text-ink-5 text-xs">
        Field Notes · <Link href="/" className="hover:text-ink transition-colors">MLB Stat DB</Link>
      </footer>
    </div>
  );
}
