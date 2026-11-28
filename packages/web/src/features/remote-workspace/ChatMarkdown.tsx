import { isValidElement, type ReactNode, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

/** The `language-x` class remark puts on a fenced block's `<code>`. */
function languageOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string }>(child)) return null;
  const match = /language-([\w+#.-]+)/.exec(child.props.className ?? "");
  return match ? match[1] : null;
}

/** Fenced code keeps the raw text in the DOM, so copy reads it from there. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const language = languageOf(children);
  return (
    <div className="rw-code-block">
      <div className="rw-code-head">
        <span>{language ?? "código"}</span>
        <CopyButton text={() => pre.current?.textContent ?? ""} label="Copiar código" />
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  a({ href, children }) {
    const external = !!href && /^https?:/i.test(href);
    return (
      <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </a>
    );
  },
};

/** Agent prose: readable markdown, fenced code with a copy action, links out of the tab. */
export function ChatMarkdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`rw-message-text${streaming ? " is-streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
