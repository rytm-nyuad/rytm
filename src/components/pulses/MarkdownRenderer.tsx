"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mt-12 mb-6">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-10 mb-5">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-xl font-semibold text-white mt-8 mb-4">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-zinc-300 text-lg leading-relaxed mb-6">
            {children}
          </p>
        ),
        strong: ({ children }) => (
          <strong className="text-white font-semibold">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="text-zinc-400 italic">{children}</em>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-outside ml-6 mb-6 space-y-2 text-zinc-300 text-lg leading-relaxed">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside ml-6 mb-6 space-y-2 text-zinc-300 text-lg leading-relaxed">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-700 pl-6 my-6 text-zinc-400 italic">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code className="block bg-zinc-900/60 rounded-lg p-4 text-sm text-zinc-300 font-mono overflow-x-auto my-6 border border-white/[0.06]">
                {children}
              </code>
            );
          }
          return (
            <code className="bg-zinc-800/60 px-1.5 py-0.5 rounded text-sm text-zinc-300 font-mono">
              {children}
            </code>
          );
        },
        hr: () => (
          <hr className="border-none h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent my-10" />
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            className="text-white underline underline-offset-2 decoration-zinc-600 hover:decoration-white transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
