import Link from 'next/link';
import { listPosts, type BlogPost } from '@/lib/blog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Notes – Stat DB' };

function PostCard({ post }: { post: BlogPost }) {
  const date = new Date(post.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  return (
    <article className="bg-panel border border-line flex flex-col overflow-hidden group hover:border-ink-5 transition-colors">
      {/* Cover image */}
      <Link href={`/blog/${post.slug}`} className="block overflow-hidden">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt={post.title}
            className="w-full h-52 object-cover object-top group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-52 bg-bone flex items-end p-4"
            style={{ background: 'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)' }}>
            <span className="font-display text-4xl font-black uppercase tracking-wider text-white/20 leading-none">
              {post.tags[0] ?? 'Analysis'}
            </span>
          </div>
        )}
      </Link>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-5">
        {/* Tags + date row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {post.tags.map(tag => (
            <span key={tag}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 bg-accent/10 text-accent border border-accent/30">
              {tag}
            </span>
          ))}
          <span className="text-ink-5 text-[11px] font-mono ml-auto">{date}</span>
        </div>

        {/* Title */}
        <Link href={`/blog/${post.slug}`}>
          <h2 className="font-display text-2xl font-black uppercase tracking-wide text-ink leading-tight mb-3
            group-hover:text-accent transition-colors">
            {post.title}
          </h2>
        </Link>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-ink-3 text-sm leading-relaxed mb-4 flex-1">{post.excerpt}</p>
        )}

        {/* Read more */}
        <Link href={`/blog/${post.slug}`}
          className="text-xs font-bold uppercase tracking-widest text-accent hover:text-red-400 transition-colors self-start mt-auto">
          Continue Reading →
        </Link>
      </div>
    </article>
  );
}

export default async function BlogPage() {
  let posts: BlogPost[] = [];
  try { posts = await listPosts(true); } catch { /* blob not configured yet */ }

  const featured = posts[0] ?? null;
  const rest = posts.slice(1);

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* ── Header ── */}
      <header className="bg-deep border-b border-line">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <Link href="/" className="text-ink-4 hover:text-ink text-xs uppercase tracking-widest transition-colors mr-4">← App</Link>
            <span className="text-ink-5">|</span>
            <span className="font-display text-3xl font-black uppercase tracking-wide text-ink ml-4">Field Notes</span>
          </div>
          <nav className="flex items-center gap-6 text-xs font-semibold uppercase tracking-widest text-ink-3">
            <Link href="/blog" className="hover:text-ink transition-colors">Home</Link>
            <Link href="/blog/admin" className="hover:text-ink transition-colors">Admin</Link>
          </nav>
        </div>
        {/* Red accent bar */}
        <div className="h-0.5 bg-accent w-full" />
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {posts.length === 0 ? (
          <div className="text-center py-32">
            <p className="font-display text-5xl uppercase tracking-wide text-ink-5 mb-3">No Posts Yet</p>
            <p className="text-ink-4 text-sm">
              <Link href="/blog/admin" className="text-accent hover:underline">Sign in to the admin</Link> to write your first post.
            </p>
          </div>
        ) : (
          <div className="flex gap-10">
            {/* ── Main content ── */}
            <div className="flex-1 min-w-0">
              {/* Featured post — full width hero */}
              {featured && (
                <div className="mb-10">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-accent mb-3">Featured</p>
                  <article className="bg-panel border border-line overflow-hidden group">
                    <Link href={`/blog/${featured.slug}`} className="block overflow-hidden">
                      {featured.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={featured.coverImageUrl} alt={featured.title}
                          className="w-full h-72 object-cover object-top group-hover:scale-[1.01] transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-72 flex items-end p-8"
                          style={{ background: 'linear-gradient(135deg,#1a1a2e 0%,#0f3460 60%,#533483 100%)' }}>
                          <span className="font-display text-7xl font-black uppercase tracking-wider text-white/10 leading-none">
                            {featured.tags[0] ?? 'Analysis'}
                          </span>
                        </div>
                      )}
                    </Link>
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-3">
                        {featured.tags.map(t => (
                          <span key={t} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 bg-accent/10 text-accent border border-accent/30">{t}</span>
                        ))}
                        <span className="text-ink-5 text-[11px] font-mono ml-auto">
                          {new Date(featured.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      </div>
                      <Link href={`/blog/${featured.slug}`}>
                        <h2 className="font-display text-4xl font-black uppercase tracking-wide text-ink leading-tight mb-3 hover:text-accent transition-colors">
                          {featured.title}
                        </h2>
                      </Link>
                      {featured.excerpt && (
                        <p className="text-ink-3 text-sm leading-relaxed mb-4 max-w-2xl">{featured.excerpt}</p>
                      )}
                      <Link href={`/blog/${featured.slug}`}
                        className="text-xs font-bold uppercase tracking-widest text-accent hover:text-red-400 transition-colors">
                        Continue Reading →
                      </Link>
                    </div>
                  </article>
                </div>
              )}

              {/* Post grid */}
              {rest.length > 0 && (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ink-4">Latest</p>
                    <div className="flex-1 h-px bg-line" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {rest.map(post => <PostCard key={post.id} post={post} />)}
                  </div>
                </>
              )}
            </div>

            {/* ── Sidebar ── */}
            <aside className="w-64 flex-shrink-0 hidden lg:block">
              <div className="sticky top-6 flex flex-col gap-6">
                {/* Recent posts */}
                <div className="bg-panel border border-line p-4">
                  <h3 className="font-display text-sm font-bold uppercase tracking-widest text-ink mb-3 pb-2 border-b border-line">
                    Recent Posts
                  </h3>
                  <div className="flex flex-col gap-3">
                    {posts.slice(0, 6).map(post => (
                      <Link key={post.id} href={`/blog/${post.slug}`}
                        className="group flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-ink group-hover:text-accent transition-colors leading-snug">
                          {post.title}
                        </span>
                        <span className="text-[10px] text-ink-5 font-mono">
                          {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Tag cloud */}
                {(() => {
                  const allTags = Array.from(new Set(posts.flatMap(p => p.tags))).sort();
                  return allTags.length > 0 ? (
                    <div className="bg-panel border border-line p-4">
                      <h3 className="font-display text-sm font-bold uppercase tracking-widest text-ink mb-3 pb-2 border-b border-line">
                        Topics
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map(tag => (
                          <span key={tag}
                            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 bg-bone text-ink-3 border border-line">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* About blurb */}
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
        )}
      </main>

      <footer className="border-t border-line mt-16 py-6 text-center text-ink-5 text-xs">
        Field Notes · <Link href="/" className="hover:text-ink transition-colors">MLB Stat DB</Link>
      </footer>
    </div>
  );
}
