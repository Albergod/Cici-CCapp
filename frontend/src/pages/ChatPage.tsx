import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { api } from '@/services/api';
import { Conversation, Message } from '@/types';
import { Loader2, Send, ArrowLeft, MessageSquare } from 'lucide-react';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, token } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadConversations();
  }, [isAuthenticated]);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const loadConversations = async () => {
    try {
      const data = await api.chat.listConversations();
      setConversations(data);
      if (!conversationId && data.length > 0 && user) {
        navigate(`/chat/${data[0].id}`, { replace: true });
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const flat = await api.chat.listConversations();
      const convData = flat.find((c) => c.id === id);
      setActiveConversation(convData || null);
      const messagesData = await api.chat.getMessages(id);
      setMessages(messagesData);
      connectWebSocket(id);
    } catch (err) {
      console.error('Error loading conversation:', err);
    }
  };

  const connectWebSocket = (convId: string) => {
    wsRef.current?.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/chat?token=${token}&conversationId=${convId}`
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        setMessages((prev) => [...prev, data.message]);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setSending(true);
    try {
      wsRef.current.send(JSON.stringify({ content: newMessage.trim() }));
      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getConversationTitle = (conv: Conversation) =>
    conv.store?.name || conv.customer?.name || 'Conversación';

  const getConversationAvatar = (conv: Conversation) =>
    conv.store?.logoUrl || conv.customer?.avatarUrl || null;

  const getConversationInitial = (conv: Conversation) => {
    const name = conv.store?.name || conv.customer?.name || '';
    return name.charAt(0).toUpperCase() || '?';
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16 flex">
      <div className="w-full sm:w-80 bg-white border-r border-surface-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-surface-200">
          <h2 className="font-extrabold text-surface-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-500" />
            Mensajes
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-surface-400">
              No hay conversaciones aún
            </div>
          ) : (
            conversations.map((conv) => {
              const avatar = getConversationAvatar(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => navigate(`/chat/${conv.id}`)}
                  className={`w-full p-4 text-left hover:bg-surface-50 transition-colors border-b border-surface-100 ${
                    conversationId === conv.id ? 'bg-brand-50/60' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center overflow-hidden shrink-0">
                      {avatar ? (
                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-white">
                          {getConversationInitial(conv)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-surface-900 text-sm truncate">
                        {getConversationTitle(conv)}
                      </p>
                      <p className="text-xs text-surface-500 truncate">
                        {conv.lastMessage?.content || 'Sin mensajes'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {activeConversation ? (
          <>
            <div className="h-16 px-4 flex items-center gap-4 border-b border-surface-200 bg-white">
              <button
                onClick={() => navigate('/chat')}
                className="sm:hidden p-2 hover:bg-surface-100 rounded-lg transition-colors text-surface-600"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center overflow-hidden">
                  {getConversationAvatar(activeConversation) ? (
                    <img
                      src={getConversationAvatar(activeConversation)!}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-bold text-white">
                      {getConversationInitial(activeConversation)}
                    </span>
                  )}
                </div>
                <span className="font-bold text-surface-900">
                  {getConversationTitle(activeConversation)}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-50/50">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.senderId === user?.id ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl shadow-soft ${
                      msg.senderId === user?.id
                        ? 'bg-gradient-to-r from-brand-600 to-accent-500 text-white'
                        : 'bg-white text-surface-900'
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p
                      className={`text-xs mt-1 ${
                        msg.senderId === user?.id ? 'text-white/70' : 'text-surface-400'
                      }`}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-4 border-t border-surface-200 bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  disabled={sending}
                  className="input !rounded-full"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim() || sending}
                  className="p-2.5 bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-all text-white shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-surface-400 bg-surface-50/50">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white shadow-soft flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-8 h-8 text-brand-400" />
              </div>
              Selecciona una conversación
            </div>
          </div>
        )}
      </div>
    </div>
  );
}