import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/** Markdownのコードブロックを“見やすく＋コピーしやすく”表示 */
export default function CodeBlock({ children, language }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, '');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_) {}
  };

  return (
    <div>
      <div className="code-toolbar">
        <span className="code-lang">{language || 'text'}</span>
        <button className="copy-btn" onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <SyntaxHighlighter language={language} style={vscDarkPlus} PreTag="div">
        {text}
      </SyntaxHighlighter>
    </div>
  );
}