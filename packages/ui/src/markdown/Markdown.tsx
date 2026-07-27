import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";

export type LinkPolicy = "inert" | "external";

export function Markdown({
  text,
  linkPolicy,
  className,
}: {
  text: string;
  linkPolicy: LinkPolicy;
  className?: string;
}) {
  const components: Components = {
    h1: ({ children }) => <div className="md-heading md-h1">{children}</div>,
    h2: ({ children }) => <div className="md-heading md-h2">{children}</div>,
    h3: ({ children }) => <div className="md-heading md-h3">{children}</div>,
    h4: ({ children }) => <div className="md-heading md-h3">{children}</div>,
    h5: ({ children }) => <div className="md-heading md-h3">{children}</div>,
    h6: ({ children }) => <div className="md-heading md-h3">{children}</div>,
    a: ({ children, href }) =>
      linkPolicy === "inert" ? (
        <span className="md-link" title={href}>
          {children}
        </span>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
  };
  // remark-breaks: the legacy renderer emitted <br> for single newlines
  // inside a paragraph — spoken summaries rely on that line rhythm.
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
