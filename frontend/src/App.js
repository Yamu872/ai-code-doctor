import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';

const WEBSOCKET_API_URL = 'wss://7dslat2lz5.execute-api.ap-northeast-1.amazonaws.com/prod'; // WebSocket APIのURLを設定
const MAX_RETRY_DELAY_MS = 10000;

function App() {
  const [messages, setMessages] = useState([]);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('React (JavaScript)');
  const [isLoading, setIsLoading] = useState(false);
  const [ws, setWs] = useState(null);

  // --- オートリコネクト用の参照 ---
  const shouldReconnectRef = useRef(true);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const socketRef = useRef(null);
  const listRef = useRef(null);
  const connectRef = useRef(() => {});

  const setupHandlers = useCallback((socket) => {
    socket.onopen = () => {
      console.log('WebSocket connection opened');
      setWs(socket);
      retryCountRef.current = 0; // 成功したらリトライ回数をリセット
      setMessages(prev =>
        prev.length === 0
          ? [{ text: 'こんにちは！ AIコードドクターです。お手伝いできることはありますか？', sender: 'ai' }]
          : [...prev, { text: '⚡ 再接続しました。続きからどうぞ。', sender: 'ai' }]
      );
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'PENDING') {
        setIsLoading(true);
        setMessages(prev => [...prev, { id: 'stream', text: '', sender: 'ai' }]);
        return;
      } 
      
      if (data.status === 'DELTA') {
        // 受け取るたびに末尾へ追記
        setMessages(prev =>
          prev.map(m => m.id === 'stream' ? { ...m, text: m.text + (data.text || '') } : m)
        );
        return;
      }

      if (data.status === 'ERROR') {
        // 既存の“レビュー中”泡をエラー文に置き換える or 新規で出す
        const msg = data.message || 'エラーが発生しました。時間をおいて再実行してください。';
        setMessages(prev => {
          const base = prev.filter(m => m.id !== 'loading');
          const hasStream = base.some(m => m.id === 'stream');
          if (hasStream) {
            return base.map(m => m.id === 'stream' ? { ...m, id: undefined, text: `⚠️ ${msg}` } : m);
          }
          return [...base, { text: `⚠️ ${msg}`, sender: 'ai' }];
        });
        setIsLoading(false);
        return;
      }


      if (data.status === 'END') {
        // 確定（idを外す）＆ローディング解除
        setMessages(prev => prev.map(m => m.id === 'stream' ? { ...m, id: undefined } : m));
        setIsLoading(false);
        return;
      }

      // 互換: 古いサーバが COMPLETED を送る可能性に一応対応
      if (data.status === 'COMPLETED') {
        setMessages(prev => [...prev, { text: data.review, sender: 'ai' }]);
        setIsLoading(false);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      if (!shouldReconnectRef.current) return; // アンマウント時などは再接続しない
      const delay = Math.min(1000 * (2 ** retryCountRef.current), MAX_RETRY_DELAY_MS); // 指数バックオフ
      retryCountRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        connectRef.current();// 再接続
      }, delay);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      // エラー時はいったん閉じて onclose 側でリトライさせる
      try { socket.close(); } catch (_) {}
    };
  }, []);

  const connect = useCallback(() => {
    const socket = new WebSocket(WEBSOCKET_API_URL);
    socketRef.current = socket;
    setupHandlers(socket);
  }, [setupHandlers]);

  useEffect(() => {           // connect の最新版を Ref に同期
  connectRef.current = connect;
}, [connect]);

  useEffect(() => {
    // 初回接続
    connectRef.current(); 

    // クリーンアップ：再接続停止＆タイマー解除＆ソケットクローズ
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      const s = socketRef.current;
      if (s && s.readyState === WebSocket.OPEN) {
        s.close();
      }
    };
  }, [connect]);

  /** メッセージが増えたら最下部へスクロール */
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleReview = () => {
    // 接続確認
    const isOpen = ws && ws.readyState === WebSocket.OPEN;
    if (code.trim() === '' || !isOpen) {
      if (!isOpen) {
        setMessages(prev => [
          ...prev,
          { text: '🔌 接続が切れています。自動で再接続中です。少し待ってからもう一度お試しください。', sender: 'ai' }
        ]);
      }
      return;
    }

    const userMessage = { text: code, sender: 'user', language: language };
    setMessages(prevMessages => [...prevMessages, userMessage]);
    setCode('');
    setIsLoading(true);

    // WebSocket経由でメッセージを送信
    ws.send(JSON.stringify({
      code: code,
      language: language,
      question: 'このコードをレビューして、エラーの根本原因と改善点を初心者向けに解説してください。'
    }));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReview();
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand">
          <div className="dot" />
          <h1>AIコードドクター</h1>
        </div>
        <p className="description">
          コードやエラーメッセージを貼り付けて、「AIコードドクター」にレビューを依頼しましょう。
          プログラミング言語ごとのベストプラクティスに基づいて優しく解説します。
        </p>
      </header>

      <div className="chat-window">
        <div className="message-list" ref={listRef}>
          {messages.length === 0 && (
            <div className="welcome-message">
              <p>WebSocketに接続しています...</p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={index} className={`message-container ${msg.sender}`}>
              <div className="message-bubble">
                {msg.sender === 'user' && msg.language && <p className="message-meta">言語: {msg.language}</p>}
                <ReactMarkdown
                  children={msg.text}
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      if (!inline && match) {
                        // 高機能なコードブロック（コピー等）
                        return <CodeBlock language={match[1]}>{children}</CodeBlock>;
                      }
                      // 行内コード
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                />
              </div>
            </div>
          ))}

          {/* ストリーミング中のタイピングインジケータ */}
          {isLoading && (
            <div className="message-container ai">
              <div className="message-bubble typing-bubble">
                <div className="typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="input-area">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={isLoading}
          className="language-select"
          aria-label="言語を選択"
        >
          <option value="React (JavaScript)">React (JavaScript)</option>
          <option value="Python">Python</option>
        </select>

        <textarea
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="コードと質問を入力してください…（Enter で送信 / Shift+Enter で改行）"
          disabled={isLoading}
          aria-label="コードと質問の入力欄"
        />

        <button onClick={handleReview} disabled={isLoading || code.trim() === ''} aria-label="レビューを依頼">
          レビューを依頼
        </button>
      </footer>
    </div>
  );
}

export default App;