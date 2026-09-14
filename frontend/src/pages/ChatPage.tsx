import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { api } from '@/services/api';
import { Conversation, Message } from '@/types';
import { Loader2, Send, ArrowLeft, MessageSquare, Bot, MessageCircle, Receipt } from 'lucide-react';

const isInvoice = (content: string) =>
  content.includes('Pedido Confirmado') || content.includes('✅ *Pedido*');

// Altura del contenedor: viewport menos el navbar (120px en móvil por la fila
// de búsqueda, 64px en md+). Usa dvh cuando el navegador lo soporta para que
// el teclado y las barras del móvil no rompan el input anclado.
const CHAT_HEIGHT =
  'h-[calc(100vh-7.5rem)] supports-[height:100dvh]:h-[calc(100dvh-7.5rem)] md:h-[calc(100vh-4rem)] md:supports-[height:100dvh]:h-[calc(100dvh-4rem)]';

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

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
      // En escritorio se muestra lista + hilo, así que abrir el primer chat.
      // En móvil se ve UNA vista a la vez; el usuario elige en la lista.
      if (!conversationId && data.length > 0 && user && isDesktop()) {
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
      api.chat
        .markRead(id)
        .then(() => updateConversationReadState(id))
        .catch(() => {});
    } catch (err) {
      console.error('Error loading conversation:', err);
    }
  };

  // Actualiza en la lista solo la conversación indicada (último mensaje y
  // badge de no leídos) sin volver a cargar todo.
  const updateConversationReadState = (convId: string, message?: Message) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessage: message ?? c.lastMessage,
              unreadCount:
                message && message.senderId === user?.id ? c.unreadCount : 0,
            }
          : c,
      ),
    );
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
        updateConversationReadState(convId, data.message);
        if (data.message.senderId !== user?.id) {
          api.chat.markRead(convId).catch(() => {});
        }
      }
    };

    ws.onerror = (error) => {
      console.warn('WebSocket error:', error);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };

    wsRef.current = ws;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newMessage.trim();
    if (!content || !conversationId) return;

    setSending(true);
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ content }));
          setNewMessage('');
          return;
        } catch (err) {
          console.warn('WebSocket falló, reintentando por HTTP:', err);
        }
      }
      // El WebSocket no está disponible: se usa el endpoint HTTP (el servidor
      // igual genera la respuesta IA y la guarda).
      const { message, aiReply } = await api.chat.sendMessage(conversationId, content);
      const appended = aiReply ? [message, aiReply] : [message];
      setMessages((prev) => [...prev, ...appended]);
      updateConversationReadState(conversationId, aiReply || message);
      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
      alert('No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const scrollToBottom = () => {
    const el = messagesEndRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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
      <div className={`${CHAT_HEIGHT} flex items-center justify-center`}>
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`${CHAT_HEIGHT} flex overflow-hidden`}>
      {/* Lista de conversaciones: única vista en móvil cuando no hay hilo abierto */}
      <div
        className={`${
          conversationId ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 bg-white border-r border-surface-200 flex-col shrink-0`}
      >
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
              const unread = conv.unreadCount ?? 0;
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
                    {unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-accent-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Hilo: única vista en móvil cuando hay una conversación abierta */}
      <div
        className={`${
          conversationId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col min-w-0`}
      >
        {activeConversation ? (
          <>
            <div className="h-16 px-4 flex items-center gap-4 border-b border-surface-200 bg-white shrink-0">
              <button
                onClick={() => navigate('/chat')}
                className="md:hidden -ml-1 p-2 -mr-1 hover:bg-surface-100 rounded-lg transition-colors text-surface-600"
                aria-label="Volver a la lista"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center overflow-hidden shrink-0">
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
                <span className="font-bold text-surface-900 truncate">
                  {getConversationTitle(activeConversation)}
                </span>
              </div>
              {activeConversation?.store?.whatsapp && user?.id === activeConversation.customerId && (
                <a
                  href={`https://wa.me/${activeConversation.store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                    `Hola ${activeConversation.store.name}! Me interesa continuar esta conversación en el chat de la tienda.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Continuar por WhatsApp"
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-600 border border-green-200 text-xs font-bold hover:bg-green-100 transition-colors whitespace-nowrap"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-50/50" ref={messagesEndRef}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.senderId === user?.id ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] lg:max-w-md px-4 py-2.5 rounded-2xl shadow-soft ${
                      msg.senderId === user?.id
                        ? 'bg-gradient-to-r from-brand-600 to-accent-500 text-white'
                        : 'bg-white text-surface-900'
                    }`}
                  >
                    {msg.aiGenerated && (
                      <div
                        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mb-1 px-1.5 py-0.5 rounded-full ${
                          msg.senderId === user?.id
                            ? 'bg-white/20 text-white'
                            : 'bg-brand-50 text-brand-600'
                        }`}
                      >
                        <Bot className="w-3 h-3" />
                        Respuesta IA
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    {msg.aiGenerated && isInvoice(msg.content) && activeConversation?.store?.whatsapp && user?.id === activeConversation.customerId && (
                      <a
                        href={`https://wa.me/${activeConversation.store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg.waText || msg.content)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 inline-flex items-center gap-1.5 w-full justify-center py-2 px-3 rounded-lg text-xs font-bold text-white bg-green-500 hover:bg-green-600 transition-colors"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        Enviar pedido al comerciante
                      </a>
                    )}
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
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-surface-200 bg-white shrink-0"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  disabled={sending}
                  className="input !rounded-full flex-1 min-w-0"
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
        ) : conversationId ? (
          <div className="flex-1 flex items-center justify-center bg-surface-50/50">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-surface-400 bg-surface-50/50">
            <div className="text-center px-4">
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