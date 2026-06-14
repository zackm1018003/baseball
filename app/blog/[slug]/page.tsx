import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPost, renderMarkdown } from '@/lib/blog';

export const dynamic = 'force-dynamic';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug).catch(() => null);
  if (!post || !post.published) notFound();

  const html = renderMarkdown(post.content);

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="bg-deep border-b border-line px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/blog" className="text-ink-4 hover:text-ink text-sm transition-colors">← Field Notes</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <time className="text-ink-4 text-xs font-mono">
              {new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </time>
            {post.tags.map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-px bg-bone text-ink-3 uppercase tracking-wide">{tag}</span>
            ))}
          </div>
          <h1 className="font-display text-4xl uppercase tracking-wide text-ink mb-3">{post.title}</h1>
          {post.excerpt && (
            <p className="text-ink-3 text-base leading-relaxed border-l-2 border-accent pl-4">{post.excerpt}</p>
          )}
        </div>

        <div
          className="prose-blog"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
    </div>
  );
}
