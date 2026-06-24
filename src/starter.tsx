/**
 * QueueMaster Frontend — Complete Application
 * REDESIGNED: Premium Black/Green Theme
 *
 * Stack: React 18, TypeScript, Vite, Framer Motion,
 *        React Query, Zustand, Socket.IO, Recharts, Lucide Icons
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  FC,
  ReactNode,
} from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  Link,
  useParams,
} from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios, { AxiosError } from 'axios'
import { io, Socket } from 'socket.io-client'
import {
  LayoutDashboard,
  Building2,
  Users,
  Ticket,
  BarChart3,
  Monitor,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Plus,
  Trash2,
  Edit,
  Search,
  Filter,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowRight,
  Star,
  Zap,
  Shield,
  Globe,
  TrendingUp,
  Bell,
  ChevronDown,
  Play,
  Pause,
  SkipForward,
  Activity,
  Hash,
  Timer,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  Phone,
  MapPin,
  Check,
  AlertTriangle,
  Info,
  Wifi,
  WifiOff,
  Volume2,
  Maximize,
  SlidersHorizontal,
  ArrowUpDown,
  MoreHorizontal,
  Copy,
  ExternalLink,
  Users2,
  Smartphone,
  QrCode,
} from 'lucide-react'

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

// ============================================================
// CONFIGURATION
// ============================================================

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:8000'

// ============================================================
// TYPES & INTERFACES
// ============================================================

interface User {
  id: number
  name: string
  email: string
  role: 'ADMIN' | 'AGENT'
  structure_id?: string | null
}

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  setUser: (user: User) => void
}

interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
}

interface UIState {
  sidebarOpen: boolean
  toasts: Toast[]
  toggleSidebar: () => void
  setSidebar: (open: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

interface Structure {
  id: string
  name: string
  description?: string
  address?: string
  phone?: string
  is_active: boolean
  created_at: string
  current_queue_length: number
  config: {
    alpha: number
    beta: number
    t_ref: number
    ticket_ttl: number
  }
}

interface QueueTicket {
  uuid: string
  number: number
  type_index: number
  priority_value: number
  created_at: number
  structure_id: string
  position: number
  estimated_wait: number
  type_name: string
}

interface Agent {
  id: number
  name: string
  email: string
  structure_id?: string
  is_active: boolean
  created_at: string
}

interface StructureType {
  name: string
  priority: number
}

interface Statistics {
  date: string
  tickets_created: number
  tickets_served: number
  tickets_expired: number
  avg_wait_time: number
  avg_service_time: number
}

interface GlobalStats {
  structure_id: string
  structure_name: string
  current_queue_length: number
  average_service_time: number
  statistics: Statistics[]
}

// Public ticket tracking response
interface PublicTicketData {
  ticketUuid: string
  ticketNumber: number | null
  ticketType: string | null
  status: 'waiting' | 'called' | 'expired'
  position: number | null
  peopleAhead: number | null
  estimatedWait: number | null
  structureId: string | null
  structureName: string | null
  trackingUrl: string
}

// ============================================================
// ZUSTAND STORES
// ============================================================

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      login: (token, user) =>
        set({ token, user, isAuthenticated: true }),
      logout: () =>
        set({ token: null, user: null, isAuthenticated: false }),
      setUser: (user) => set({ user }),
    }),
    { name: 'queuemaster-auth' }
  )
)

const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  toasts: [],
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open) => set({ sidebarOpen: open }),
  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: Math.random().toString(36) }],
    })),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// ============================================================
// AXIOS API CLIENT
// ============================================================

const apiClient = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      const token = useAuthStore.getState().token
      if (!token) {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(err)
  }
)

// ============================================================
// PUBLIC API CLIENT (no auth)
// ============================================================

const publicApiClient = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
})

// ============================================================
// API FUNCTIONS
// ============================================================

const api = {
  login: async (email: string, password: string) => {
    const { data } = await apiClient.post('/auth/login', { email, password })
    return data
  },

  register: async (name: string, email: string, password: string) => {
    const { data } = await apiClient.post('/auth/register', {
      name,
      email,
      password,
    })
    return data
  },

  getStructures: async (): Promise<{ structures: Structure[] }> => {
    const { data } = await apiClient.get('/structures')
    return data
  },

  createStructure: async (payload: Partial<Structure> & { types?: StructureType[] }) => {
    const { data } = await apiClient.post('/structures', payload)
    return data
  },

  updateStructure: async (id: string, payload: Partial<Structure>) => {
    const { data } = await apiClient.put(`/structures/${id}`, payload)
    return data
  },

  deleteStructure: async (id: string) => {
    const { data } = await apiClient.delete(`/structures/${id}`)
    return data
  },

  getStructureTypes: async (id: string) => {
    const { data } = await apiClient.get(`/structures/${id}/types`)
    return data
  },

  getStructureStats: async (id: string, days = 30): Promise<GlobalStats> => {
    const { data } = await apiClient.get(`/structures/${id}/stats?days=${days}`)
    return data
  },

  updateStructureConfig: async (id: string, config: Record<string, unknown>) => {
    const { data } = await apiClient.put(`/structures/${id}/config`, config)
    return data
  },

  getQueue: async (structureId: string): Promise<{ queue: QueueTicket[]; queue_length: number }> => {
    const { data } = await apiClient.get(`/structures/${structureId}/queue`)
    return data
  },

  getCurrentTicket: async (
    structureId: string
  ): Promise<{ ticket: { uuid: string; number: number; type_index: number; type_name: string } | null }> => {
    const { data } = await apiClient.get(`/structures/${structureId}/current-ticket`)
    return data
  },

  createTicket: async (structureId: string, type_index = 0) => {
    const { data } = await apiClient.post(`/structures/${structureId}/tickets`, {
      type_index,
    })
    return data
  },

  deleteTicket: async (ticketUuid: string) => {
    const { data } = await apiClient.delete(`/tickets/${ticketUuid}`)
    return data
  },

  updateTicketType: async (ticketUuid: string, type_index: number) => {
    const { data } = await apiClient.patch(`/tickets/${ticketUuid}/type`, {
      type_index,
    })
    return data
  },

  getTicketPosition: async (ticketUuid: string) => {
    const { data } = await apiClient.get(`/tickets/${ticketUuid}/position`)
    return data
  },

  callNext: async (structureId: string) => {
    const { data } = await apiClient.post(`/structures/${structureId}/next`)
    return data
  },

  completeService: async (structureId: string, service_time?: number) => {
    const params = service_time ? `?service_time=${service_time}` : ''
    const { data } = await apiClient.post(
      `/structures/${structureId}/complete${params}`
    )
    return data
  },

  getAgents: async (): Promise<{ agents: Agent[] }> => {
    const { data } = await apiClient.get('/agents')
    return data
  },

  createAgent: async (
    name: string,
    email: string,
    password: string,
    structure_id?: string
  ) => {
    const params = structure_id ? `?structure_id=${structure_id}` : ''
    const { data } = await apiClient.post(`/agents${params}`, {
      name,
      email,
      password,
    })
    return data
  },

  deleteAgent: async (agentId: number) => {
    const { data } = await apiClient.delete(`/agents/${agentId}`)
    return data
  },

  healthCheck: async () => {
    const { data } = await apiClient.get('/health')
    return data
  },

  // Public API - no auth required
  getPublicTicket: async (ticketUuid: string): Promise<PublicTicketData> => {
    const { data } = await publicApiClient.get(`/public/tickets/${ticketUuid}`)
    return data
  },
}

// ============================================================
// WEBSOCKET HOOK
// ============================================================

interface WSEvent {
  type: string
  data: unknown
}

const useWebSocket = (
  structureId?: string | null,
  onEvent?: (event: WSEvent) => void
) => {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const { token } = useAuthStore()

  useEffect(() => {
    if (!structureId) return

    const socket = io(`${WS_URL}/ws/structure`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_structure', { structure_id: structureId })
    })

    socket.on('disconnect', () => setConnected(false))

    const events = [
      'ticket-created',
      'ticket-updated',
      'ticket-deleted',
      'queue-updated',
      'ticket-called',
      'position-update',
      'position-alert',
      'your-turn',
      'display-update',
    ]

    events.forEach((ev) => {
      socket.on(ev, (data: unknown) => {
        onEvent?.({ type: ev, data })
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [structureId, token])

  return { connected, socket: socketRef.current }
}

// ============================================================
// PUBLIC TICKET WEBSOCKET HOOK
// ============================================================

interface TicketWSEvent {
  type: string
  data: {
    position?: number
    ticket?: { uuid: string; number: number; type_name: string }
    message?: string
  }
}

const usePublicTicketSocket = (
  ticketUuid: string | null,
  onEvent?: (event: TicketWSEvent) => void
) => {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setWsConnected] = useState(false)

  useEffect(() => {
    if (!ticketUuid) return

    const socket = io(`${WS_URL}/ws/ticket`, {
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setWsConnected(true)
      socket.emit('join_ticket', { ticket_uuid: ticketUuid })
    })

    socket.on('disconnect', () => setWsConnected(false))

    const events = ['position-update', 'position-alert', 'your-turn', 'ticket-cancelled']

    events.forEach((ev) => {
      socket.on(ev, (data: unknown) => {
        onEvent?.({ type: ev, data: data as TicketWSEvent['data'] })
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [ticketUuid, onEvent])

  return { connected, socket: socketRef.current }
}

const useDisplaySocket = (structureId?: string) => {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastCalled, setLastCalled] = useState<{
    number: number
    type_name: string
  } | null>(null)

  useEffect(() => {
    if (!structureId) return

    const socket = io(`${WS_URL}/ws/display`, {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_display', { structure_id: structureId })
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('display-update', (data: { ticket: { number: number; type_name: string } }) => {
      setLastCalled(data.ticket)
    })

    return () => socket.disconnect()
  }, [structureId])

  return { connected, lastCalled }
}

// ============================================================
// TOAST SYSTEM
// ============================================================

const ToastContainer: FC = () => {
  const { toasts, removeToast } = useUIStore()

  const icons = {
    success: <CheckCircle size={18} />,
    error: <AlertCircle size={18} />,
    warning: <AlertTriangle size={18} />,
    info: <Info size={18} />,
  }

  useEffect(() => {
    toasts.forEach((t) => {
      const timer = setTimeout(() => removeToast(t.id), 4000)
      return () => clearTimeout(timer)
    })
  }, [toasts, removeToast])

  return (
    <div className="toast-container">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast-${t.type}`}
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <div className="toast-icon">{icons[t.type]}</div>
            <div className="toast-content">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-message">{t.message}</div>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="toast-close"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ============================================================
// UTILITY HOOKS
// ============================================================

const useToast = () => {
  const { addToast } = useUIStore()

  return {
    success: (title: string, message?: string) =>
      addToast({ type: 'success', title, message }),
    error: (title: string, message?: string) =>
      addToast({ type: 'error', title, message }),
    warning: (title: string, message?: string) =>
      addToast({ type: 'warning', title, message }),
    info: (title: string, message?: string) =>
      addToast({ type: 'info', title, message }),
  }
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`
  return `${(seconds / 3600).toFixed(1)}h`
}

const formatWaitTime = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)} secondes`
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60)
    return `${mins} minute${mins > 1 ? 's' : ''}`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return `${hours}h ${mins}min`
}

const formatDate = (isoString: string): string => {
  return new Date(isoString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const getPriorityColor = (priority: number): string => {
  if (priority === 1) return 'var(--text-muted)'
  if (priority === 2) return 'var(--brand-warning)'
  return 'var(--brand-danger)'
}

const getPriorityBadgeClass = (priority: number): string => {
  if (priority === 1) return 'badge-ghost'
  if (priority === 2) return 'badge-warning'
  return 'badge-danger'
}

// ============================================================
// MODAL COMPONENT
// ============================================================

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'default' | 'lg'
  footer?: ReactNode
}

const Modal: FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'default',
  footer,
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`modal ${size === 'lg' ? 'modal-lg' : ''}`}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">{title}</h3>
              <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ============================================================
// SIDEBAR COMPONENT
// ============================================================

interface NavLink {
  path: string
  label: string
  icon: ReactNode
  badge?: number
  adminOnly?: boolean
}

const Sidebar: FC = () => {
  const { user, logout } = useAuthStore()
  const { sidebarOpen, setSidebar } = useUIStore()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const isAdmin = user?.role === 'ADMIN'

  const navLinks: NavLink[] = [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard size={18} />,
    },
    ...(isAdmin
      ? [
          {
            path: '/structures',
            label: 'Structures',
            icon: <Building2 size={18} />,
            adminOnly: true,
          },
          {
            path: '/agents',
            label: 'Agents',
            icon: <Users size={18} />,
            adminOnly: true,
          },
        ]
      : []),
    {
      path: isAdmin
        ? '/queue'
        : `/queue/${user?.structure_id || ''}`,
      label: 'File d\'attente',
      icon: <Ticket size={18} />,
    },
    {
      path: '/statistics',
      label: 'Statistiques',
      icon: <BarChart3 size={18} />,
    },
    {
      path: '/display',
      label: 'Affichage',
      icon: <Monitor size={18} />,
    },
    {
      path: '/settings',
      label: 'Paramètres',
      icon: <Settings size={18} />,
    },
  ]

  const handleLogout = () => {
    logout()
    toast.info('Déconnecté', 'À bientôt !')
    navigate('/login')
  }

  return (
    <>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebar(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Ticket size={20} />
            </div>
            <span className="sidebar-logo-text">QueueMaster</span>
          </div>
        </div>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-role">
              <span className={`badge ${isAdmin ? 'badge-primary' : 'badge-success'}`}>
                {user?.role}
              </span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <span className="sidebar-section-label">Navigation</span>
            {navLinks.map((link) => {
              const active = location.pathname === link.path ||
                location.pathname.startsWith(link.path + '/')

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => window.innerWidth < 1024 && setSidebar(false)}
                >
                  <span className="nav-item-icon">{link.icon}</span>
                  <span className="nav-item-label">{link.label}</span>
                  {link.badge !== undefined && (
                    <span className="nav-badge">{link.badge}</span>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item nav-item-logout" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>
    </>
  )
}

// ============================================================
// PAGE HEADER COMPONENT
// ============================================================

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

const PageHeader: FC<PageHeaderProps> = ({ title, subtitle, actions }) => {
  const { toggleSidebar } = useUIStore()

  return (
    <header className="page-header">
      <div className="page-header-left">
        <button className="btn btn-ghost btn-icon mobile-menu-btn" onClick={toggleSidebar}>
          <Menu size={20} />
        </button>
        <div className="page-header-info">
          <h2 className="page-header-title">{title}</h2>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="page-header-actions">{actions}</div>
    </header>
  )
}

// ============================================================
// APP SHELL
// ============================================================

const AppShell: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
      <ToastContainer />
    </div>
  )
}

// ============================================================
// ROUTE GUARD
// ============================================================

const RequireAuth: FC<{ children: ReactNode; adminOnly?: boolean }> = ({
  children,
  adminOnly = false,
}) => {
  const { isAuthenticated, user } = useAuthStore()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (adminOnly && user?.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

// ============================================================
// PUBLIC TICKET TRACKING PAGE
// ============================================================

const PublicTicketTrackingPage: FC = () => {
  const { ticketUuid } = useParams<{ ticketUuid: string }>()
  const [ticketData, setTicketData] = useState<PublicTicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  const fetchTicket = useCallback(async () => {
    if (!ticketUuid) return

    setLoading(true)
    setError(null)

    try {
      const data = await api.getPublicTicket(ticketUuid)
      setTicketData(data)
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      setError(axiosError.response?.data?.detail || 'Ticket introuvable')
    } finally {
      setLoading(false)
    }
  }, [ticketUuid])

  useEffect(() => {
    fetchTicket()
    const interval = setInterval(fetchTicket, 10000)
    return () => clearInterval(interval)
  }, [fetchTicket])

  const handleSocketEvent = useCallback((event: TicketWSEvent) => {
    if (event.type === 'position-update' || event.type === 'position-alert') {
      fetchTicket()
    }
    if (event.type === 'your-turn') {
      setTicketData((prev) => prev ? { ...prev, status: 'called' } : null)
    }
    if (event.type === 'ticket-cancelled') {
      setError('Ce ticket a été annulé')
    }
  }, [fetchTicket])

  usePublicTicketSocket(ticketUuid || null, handleSocketEvent)

  const playAlertSound = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } catch {
      // AudioContext not available
    }
  }, [])

  // Call alert when position is 3, 2, 1
  useEffect(() => {
    if (ticketData?.status === 'waiting' && ticketData.position && ticketData.position <= 3) {
      playAlertSound()
    }
  }, [ticketData?.position, ticketData?.status, playAlertSound])

  if (loading) {
    return (
      <div className="public-tracking-page">
        <div className="public-tracking-container">
          <div className="public-tracking-loader">
            <div className="spinner spinner-lg" />
            <p>Chargement de votre ticket...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="public-tracking-page">
        <div className="public-tracking-container">
          <motion.div
            className="public-tracking-error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="public-tracking-error-icon">
              <AlertCircle size={48} />
            </div>
            <h2>Ticket introuvable</h2>
            <p>{error}</p>
            <p className="public-tracking-error-hint">
              Ce ticket a peut-être expiré ou a déjà été servi.
            </p>
            <Link to="/">
              <button className="btn btn-primary">
                <ArrowRight size={16} />
                Retour à l'accueil
              </button>
            </Link>
          </motion.div>
        </div>
      </div>
    )
  }

  if (!ticketData) {
    return null
  }

  return (
    <div className="public-tracking-page">
      <div className="public-tracking-container">
        <motion.div
          className="public-tracking-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="public-tracking-header">
            <div className="public-tracking-logo">
              <div className="public-tracking-logo-icon">
                <Ticket size={24} />
              </div>
              <span>QueueMaster</span>
            </div>
            <div className={`ws-status ${wsConnected ? 'connected' : ''}`}>
              {wsConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{wsConnected ? 'Live' : 'Offline'}</span>
            </div>
          </div>

          {ticketData.status === 'called' ? (
            <motion.div
              className="public-tracking-called"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 15 }}
            >
              <motion.div
                className="public-tracking-called-pulse"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Bell size={32} />
              </motion.div>
              <h1>Votre tour est arrivé !</h1>
              <div className="public-tracking-ticket-number called">
                {ticketData.ticketNumber?.toString().padStart(3, '0')}
              </div>
              <p className="public-tracking-called-message">
                Présentez-vous au guichet
              </p>
              <span className="badge badge-success">
                <CheckCircle size={14} /> Appelé
              </span>
            </motion.div>
          ) : ticketData.status === 'expired' ? (
            <motion.div
              className="public-tracking-expired"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="public-tracking-expired-icon">
                <Clock size={48} />
              </div>
              <h2>Ticket expiré</h2>
              <p>Votre ticket a expiré ou a été traité.</p>
              <p className="public-tracking-expired-hint">
                Si vous n'avez pas été servi, veuillez prendre un nouveau ticket.
              </p>
            </motion.div>
          ) : (
            <div className="public-tracking-waiting">
              <div className="public-tracking-ticket-info">
                <div className="public-tracking-label">Votre numéro</div>
                <motion.div
                  className="public-tracking-ticket-number"
                  animate={ticketData.position && ticketData.position <= 3 ? {
                    scale: [1, 1.05, 1],
                  } : {}}
                  transition={{ duration: 0.5, repeat: ticketData.position && ticketData.position <= 3 ? Infinity : 0 }}
                >
                  {ticketData.ticketNumber?.toString().padStart(3, '0')}
                </motion.div>
                {ticketData.ticketType && (
                  <span className="badge badge-ghost">{ticketData.ticketType}</span>
                )}
              </div>

              <div className="public-tracking-position">
                <div className="public-tracking-position-label">Position dans la file</div>
                <div className="public-tracking-position-value">
                  <span className="position-number">{ticketData.position}</span>
                  <span className="position-suffix">/ {ticketData.peopleAhead} personnes devant vous</span>
                </div>
              </div>

              <div className="public-tracking-stats">
                <div className="public-tracking-stat">
                  <div className="public-tracking-stat-icon">
                    <Timer size={20} />
                  </div>
                  <div className="public-tracking-stat-content">
                    <div className="public-tracking-stat-label">Attente estimée</div>
                    <div className="public-tracking-stat-value">
                      {ticketData.estimatedWait ? formatWaitTime(ticketData.estimatedWait) : '—'}
                    </div>
                  </div>
                </div>

                <div className="public-tracking-stat">
                  <div className="public-tracking-stat-icon">
                    <Building2 size={20} />
                  </div>
                  <div className="public-tracking-stat-content">
                    <div className="public-tracking-stat-label">Structure</div>
                    <div className="public-tracking-stat-value">
                      {ticketData.structureName || ticketData.structureId || '—'}
                    </div>
                  </div>
                </div>
              </div>

              {ticketData.position && ticketData.position <= 3 && ticketData.position > 0 && (
                <motion.div
                  className="public-tracking-alert"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <Bell size={18} />
                  <span>
                    {ticketData.position === 1
                      ? 'Vous êtes le prochain ! Préparez-vous.'
                      : `Plus que ${ticketData.position - 1} personne${(ticketData.position - 1) > 1 ? 's' : ''} avant vous.`
                    }
                  </span>
                </motion.div>
              )}
            </div>
          )}

          <div className="public-tracking-footer">
            <div className="public-tracking-share">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                }}
              >
                <Copy size={14} />
                Partager le lien
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={14} />
                Actualiser
              </button>
            </div>
            <p className="public-tracking-updated">
              Mise à jour automatique en temps réel
            </p>
          </div>
        </motion.div>

        <Link to="/" className="public-tracking-home-link">
          <button className="btn btn-ghost">
            <ArrowRight size={16} />
            Retour à l'accueil QueueMaster
          </button>
        </Link>
      </div>
    </div>
  )
}

// ============================================================
// LANDING PAGE
// ============================================================

const LandingPage: FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()

  const features = [
    {
      icon: <Zap size={24} />,
      title: 'Temps réel instantané',
      desc: 'WebSocket bidirectionnel. Chaque changement se reflète immédiatement sur tous les écrans connectés, sans délai.',
    },
    {
      icon: <Activity size={24} />,
      title: 'Algorithme intelligent',
      desc: 'Notre moteur de scoring pondère priorité et ancienneté (Score = α·p + β·t_norm) pour un service toujours optimal.',
    },
    {
      icon: <Shield size={24} />,
      title: 'Multi-structures sécurisé',
      desc: 'Gestion isolée par structure avec contrôle d\'accès basé sur les rôles ADMIN / AGENT. Sécurité JWT robuste.',
    },
    {
      icon: <BarChart3 size={24} />,
      title: 'Analytics avancées',
      desc: 'Tableaux de bord en temps réel, historique de statistiques, temps d\'attente moyens, et export CSV.',
    },
    {
      icon: <Monitor size={24} />,
      title: 'Écran d\'affichage',
      desc: 'Écran public plein écran style aéroport / banque. Mise à jour instantanée dès l\'appel d\'un ticket.',
    },
    {
      icon: <Smartphone size={24} />,
      title: 'Suivi mobile',
      desc: 'Chaque ticket possède un lien unique pour suivre sa position en temps réel sur mobile.',
    },
    {
      icon: <Globe size={24} />,
      title: 'API REST complète',
      desc: 'Backend FastAPI avec documentation OpenAPI. Intégration rapide dans n\'importe quel système existant.',
    },
    {
      icon: <QrCode size={24} />,
      title: 'QR Codes',
      desc: 'Génération automatique de QR codes pour accès rapide à l\'écran d\'affichage et au suivi de ticket.',
    },
  ]

  const pricing = [
    {
      name: 'Starter',
      price: '49',
      desc: 'Pour les petites structures',
      features: [
        '1 structure',
        '5 agents',
        'Temps réel WebSocket',
        'Analytics 30 jours',
        'Support email',
      ],
    },
    {
      name: 'Pro',
      price: '149',
      desc: 'La solution idéale pour les entreprises',
      featured: true,
      features: [
        '10 structures',
        'Agents illimités',
        'Temps réel WebSocket',
        'Analytics 12 mois',
        'API complète',
        'Export CSV',
        'Support prioritaire',
      ],
    },
    {
      name: 'Enterprise',
      price: 'Sur devis',
      desc: 'Pour les grandes organisations',
      features: [
        'Structures illimitées',
        'Agents illimités',
        'SLA garanti 99.9%',
        'Intégration SSO',
        'Déploiement on-premise',
        'Support dédié 24/7',
      ],
    },
  ]

  const faqs = [
    {
      q: 'Comment fonctionne l\'algorithme de tri ?',
      a: 'Notre algorithme calcule un score pour chaque ticket : Score = alpha × priorité + beta × temps_normalisé. Ainsi les tickets urgents sont servis en premier, mais l\'ancienneté empêche qu\'un ticket standard attende indéfiniment.',
    },
    {
      q: 'Les tickets sont-ils persistés en base de données ?',
      a: 'Non, les tickets sont stockés uniquement en RAM pour des performances maximales. Seules les configurations, statistiques et comptes utilisateurs sont persistés en MySQL.',
    },
    {
      q: 'Peut-on avoir plusieurs structures avec des configurations différentes ?',
      a: 'Oui, chaque structure possède ses propres types de tickets, son algorithme de priorité (alpha, beta, t_ref), et son TTL d\'expiration, totalement indépendants.',
    },
    {
      q: 'Comment fonctionne le suivi mobile des tickets ?',
      a: 'Chaque ticket possède un lien unique (/track/:uuid) accessible sans authentification. Les usagers voient leur position et temps d\'attente estimé en temps réel via WebSocket.',
    },
  ]

  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-brand">
          <div className="landing-nav-logo">
            <Ticket size={18} />
          </div>
          <span className="landing-nav-title">QueueMaster</span>
        </div>

        <div className="landing-nav-actions">
          {isAuthenticated ? (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/dashboard')}>
              Dashboard <ArrowRight size={14} />
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>
                Connexion
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/register')}>
                Essai gratuit
              </button>
            </>
          )}
        </div>
      </nav>

      <section className="hero-section">
        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="hero-badge">
            <Star size={12} />
            <span>Gestion de file d'attente nouvelle génération</span>
          </div>

          <h1 className="hero-title">
            Plus jamais d'attente
            <br />
            <span className="gradient-text">sans ordre ni intelligence</span>
          </h1>

          <p className="hero-subtitle">
            QueueMaster transforme la gestion de vos files d'attente avec un
            algorithme de priorité dynamique, des mises à jour en temps réel et
            une analytics complète — pour chaque structure, chaque agent.
          </p>

          <div className="hero-cta">
            <motion.button
              className="btn btn-primary btn-xl"
              onClick={() => navigate(isAuthenticated ? '/dashboard' : '/register')}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Commencer gratuitement
              <ArrowRight size={18} />
            </motion.button>
            <motion.button
              className="btn btn-secondary btn-xl"
              onClick={() => navigate('/display')}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Monitor size={18} />
              Voir la démo
            </motion.button>
          </div>

          <div className="hero-stats">
            {[
              { value: '99.9%', label: 'Uptime garanti' },
              { value: '<50ms', label: 'Latence WebSocket' },
              { value: '∞', label: 'Tickets simultanés' },
              { value: '24/7', label: 'Monitoring actif' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                className="hero-stat"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <div className="hero-stat-value">{stat.value}</div>
                <div className="hero-stat-label">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="section section-features">
        <div className="section-container">
          <div className="section-header">
            <motion.span className="section-label" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
              Fonctionnalités
            </motion.span>
            <motion.h2 className="section-title" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              Tout ce dont vous avez besoin,
              <br />
              <span className="gradient-text">rien de superflu</span>
            </motion.h2>
            <p className="section-desc">
              Une plateforme conçue pour les équipes qui valorisent la
              performance, la clarté et l'expérience utilisateur.
            </p>
          </div>

          <div className="features-grid">
            {features.map((feat, i) => (
              <motion.div
                key={i}
                className="feature-card"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="feature-icon">{feat.icon}</div>
                <h3 className="feature-title">{feat.title}</h3>
                <p className="feature-desc">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-how">
        <div className="section-container">
          <div className="section-header">
            <span className="section-label">Comment ça marche</span>
            <h2 className="section-title">Simple. Rapide. Efficace.</h2>
          </div>

          <div className="steps-grid">
            {[
              {
                step: '01',
                title: 'Créez vos structures',
                desc: 'Configurez vos lieux d\'accueil avec les types de tickets et l\'algorithme de priorité adapté.',
              },
              {
                step: '02',
                title: 'Ajoutez vos agents',
                desc: 'Invitez vos agents et assignez-les à leurs structures respectives.',
              },
              {
                step: '03',
                title: 'Émettez des tickets',
                desc: 'Vos clients prennent un ticket numérique. Ils suivent leur position en temps réel.',
              },
              {
                step: '04',
                title: 'Gérez en temps réel',
                desc: 'Vos agents appellent le ticket suivant d\'un clic. L\'écran d\'affichage se met à jour instantanément.',
              },
            ].map((step, i) => (
              <motion.div
                key={i}
                className="step-card"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="step-number">{step.step}</div>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-desc">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-faq">
        <div className="section-container section-container--narrow">
          <div className="section-header">
            <span className="section-label">FAQ</span>
            <h2 className="section-title">Questions fréquentes</h2>
          </div>

          <div className="faq-list">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                className="faq-item"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <button
                  className="faq-trigger"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="faq-question">{faq.q}</span>
                  <motion.div
                    className="faq-icon"
                    animate={{ rotate: openFaq === i ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown size={18} />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      className="faq-answer"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <p>{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <motion.div
          className="cta-card"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
          <h2 className="cta-title">
            Prêt à optimiser votre
            <br />
            <span className="gradient-text">gestion de file d'attente ?</span>
          </h2>
          <p className="cta-desc">
            Rejoignez les équipes qui font confiance à QueueMaster pour leur
            accueil quotidien.
          </p>
          <div className="cta-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/register')}>
              Démarrer maintenant <ArrowRight size={18} />
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => navigate('/login')}>
              Se connecter
            </button>
          </div>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-content">
          <div className="landing-footer-brand">
            <div className="landing-footer-logo">
              <Ticket size={14} />
            </div>
            <span>QueueMaster</span>
          </div>
          <p className="landing-footer-copy">© 2026 QueueMaster. Tous droits réservés.</p>
          <div className="landing-footer-links">
            {['Confidentialité', 'CGU', 'Contact'].map((link) => (
              <a key={link} href="#">{link}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

// ============================================================
// LOGIN PAGE
// ============================================================

const LoginPage: FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuthStore()
  const toast = useToast()

  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await api.login(form.email, form.password)
      login(data.access_token, data.user)
      toast.success('Bienvenue !', `Connecté en tant que ${data.user.name}`)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      setError(axiosError.response?.data?.detail || 'Identifiants invalides')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <motion.div className="auth-container" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Ticket size={24} />
          </div>
          <h1 className="auth-title">Connexion</h1>
          <p className="auth-subtitle">Accédez à votre espace QueueMaster</p>
        </div>

        <div className="auth-card">
          {error && (
            <motion.div className="auth-error" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">
                <Mail size={12} />
                Email
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="vous@exemple.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <Lock size={12} />
                Mot de passe
              </label>
              <div className="input-with-icon">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-icon-btn"
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? (
                <div className="spinner" />
              ) : (
                <>
                  Se connecter <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="auth-footer">
            <span>Pas encore de compte ? <Link to="/register">S'inscrire</Link></span>
          </div>

          <div className="auth-back">
            <Link to="/">← Retour à l'accueil</Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ============================================================
// REGISTER PAGE
// ============================================================

const RegisterPage: FC = () => {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const toast = useToast()

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.password !== form.confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }

    if (form.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }

    setLoading(true)
    try {
      const data = await api.register(form.name, form.email, form.password)
      login(data.access_token, data.user)
      toast.success('Compte créé !', 'Bienvenue sur QueueMaster')
      navigate('/dashboard')
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      setError(axiosError.response?.data?.detail || 'Erreur lors de l\'inscription')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <motion.div className="auth-container" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Ticket size={24} />
          </div>
          <h1 className="auth-title">Créer un compte</h1>
          <p className="auth-subtitle">Rejoignez QueueMaster dès maintenant</p>
        </div>

        <div className="auth-card">
          {error && (
            <motion.div className="auth-error" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">
                <User size={12} />
                Nom complet
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Jean Dupont"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                minLength={2}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <Mail size={12} />
                Email
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="vous@exemple.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <Lock size={12} />
                Mot de passe
              </label>
              <div className="input-with-icon">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Min. 8 caractères"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="input-icon-btn"
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                <Lock size={12} />
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="Répétez le mot de passe"
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? (
                <div className="spinner" />
              ) : (
                <>
                  Créer mon compte <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="auth-footer">
            <span>Déjà un compte ? <Link to="/login">Se connecter</Link></span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ============================================================
// STAT WIDGET COMPONENT
// ============================================================

interface StatWidgetProps {
  label: string
  value: string | number
  icon: ReactNode
  color: string
  change?: string
  changePositive?: boolean
  subtitle?: string
}

const StatWidget: FC<StatWidgetProps> = ({
  label,
  value,
  icon,
  color,
  change,
  changePositive,
  subtitle,
}) => (
  <motion.div className="stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
    <div className="stat-icon" style={{ background: `${color}15`, borderColor: `${color}30` }}>
      <div style={{ color }}>{icon}</div>
    </div>
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
    {subtitle && <div className="stat-subtitle">{subtitle}</div>}
    {change && (
      <div className={`stat-change ${changePositive ? 'positive' : 'negative'}`}>
        {changePositive ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {change}
      </div>
    )}
  </motion.div>
)

// ============================================================
// ADMIN DASHBOARD
// ============================================================

const AdminDashboard: FC = () => {
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: structuresData, isLoading: loadingStructures } = useQuery({
    queryKey: ['structures'],
    queryFn: api.getStructures,
    refetchInterval: 30_000,
    retry: 1,
  })

  const { data: agentsData, isLoading: loadingAgents } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
    refetchInterval: 60_000,
    retry: 1,
  })

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: api.healthCheck,
    refetchInterval: 10_000,
    retry: 1,
  })

  const structures = structuresData?.structures || []
  const agents = agentsData?.agents || []
  const activeStructures = structures.filter((s) => s.is_active).length
  const totalQueue = structures.reduce((acc, s) => acc + s.current_queue_length, 0)
  const activeAgents = agents.filter((a) => a.is_active).length

  const firstStructureId = structures[0]?.id
  useWebSocket(firstStructureId, () => {
    queryClient.invalidateQueries({ queryKey: ['structures'] })
  })

  const queueChartData = structures.map((s) => ({
    name: s.name.substring(0, 15),
    tickets: s.current_queue_length,
  }))

  const CHART_COLORS = [
    '#10b981',
    '#059669',
    '#047857',
    '#065f46',
    '#064e3b',
  ]

  return (
    <AppShell>
      <PageHeader
        title="Dashboard Administrateur"
        subtitle="Vue globale de votre système de files d'attente"
        actions={
          <div className="page-header-actions-group">
            <div className="live-indicator">
              <div className="live-dot" />
              <span>Temps réel</span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => queryClient.invalidateQueries()}
            >
              <RefreshCw size={14} />
              Actualiser
            </button>
          </div>
        }
      />

      <div className="page-content">
        <motion.div
          className="stats-grid"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <StatWidget
            label="Structures actives"
            value={activeStructures}
            icon={<Building2 size={20} />}
            color="#10b981"
            subtitle={`${structures.length} total`}
          />
          <StatWidget
            label="Agents actifs"
            value={activeAgents}
            icon={<Users size={20} />}
            color="#059669"
            subtitle={`${agents.length} total`}
          />
          <StatWidget
            label="Tickets en attente"
            value={totalQueue}
            icon={<Ticket size={20} />}
            color="#f59e0b"
            subtitle="File globale"
          />
          <StatWidget
            label="Tickets servis"
            value={health?.total_tickets || 0}
            icon={<CheckCircle size={20} />}
            color="#10b981"
            subtitle="Session courante"
          />
        </motion.div>

        <div className="dashboard-grid">
          <motion.div
            className="card card-chart"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="card-header">
              <div>
                <div className="card-title">File par structure</div>
                <div className="card-subtitle">Tickets en attente actuellement</div>
              </div>
              <BarChart3 size={18} className="card-icon" />
            </div>
            <div className="card-body">
              {loadingStructures ? (
                <div className="chart-loader">
                  <div className="spinner spinner-lg" />
                </div>
              ) : queueChartData.length === 0 ? (
                <div className="empty-state empty-state--chart">
                  <BarChart3 />
                  <h3>Aucune structure</h3>
                  <p>Créez votre première structure pour commencer</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={queueChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="tickets" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>

          <motion.div
            className="card card-chart"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="card-header">
              <div>
                <div className="card-title">Distribution</div>
                <div className="card-subtitle">Part par structure</div>
              </div>
            </div>
            <div className="card-body">
              {queueChartData.length === 0 || totalQueue === 0 ? (
                <div className="empty-state empty-state--chart">
                  <Activity />
                  <p>Aucun ticket actif</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={queueChartData}
                      dataKey="tickets"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={4}
                    >
                      {queueChartData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>
        </div>

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="card-header">
            <div>
              <div className="card-title">Structures récentes</div>
              <div className="card-subtitle">État des files d'attente en temps réel</div>
            </div>
            <Link to="/structures">
              <button className="btn btn-secondary btn-sm">
                Tout voir <ChevronRight size={14} />
              </button>
            </Link>
          </div>
          {loadingStructures ? (
            <div className="table-loader">
              <div className="spinner" />
            </div>
          ) : structures.length === 0 ? (
            <div className="empty-state">
              <Building2 />
              <h3>Aucune structure</h3>
              <p>Créez votre première structure pour commencer</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Statut</th>
                    <th>File actuelle</th>
                    <th>Adresse</th>
                    <th>Créée le</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.slice(0, 5).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="table-cell-primary">{s.name}</div>
                        {s.description && (
                          <div className="table-cell-secondary">{s.description.substring(0, 40)}...</div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${s.is_active ? 'badge-success' : 'badge-ghost'}`}>
                          {s.is_active ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td>
                        <div className="queue-count">
                          <span
                            className={`queue-number ${
                              s.current_queue_length > 10
                                ? 'queue-number--danger'
                                : s.current_queue_length > 5
                                ? 'queue-number--warning'
                                : 'queue-number--success'
                            }`}
                          >
                            {s.current_queue_length}
                          </span>
                          <span className="queue-label">tickets</span>
                        </div>
                      </td>
                      <td>
                        {s.address ? (
                          <span className="table-cell-with-icon">
                            <MapPin size={12} />
                            {s.address.substring(0, 30)}
                          </span>
                        ) : (
                          <span className="table-cell-empty">—</span>
                        )}
                      </td>
                      <td className="table-cell-mono">{formatDate(s.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <Link to={`/queue/${s.id}`}>
                            <button className="btn btn-ghost btn-icon btn-sm">
                              <Eye size={14} />
                            </button>
                          </Link>
                          <Link to="/structures">
                            <button className="btn btn-ghost btn-icon btn-sm">
                              <Edit size={14} />
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </AppShell>
  )
}

// ============================================================
// AGENT DASHBOARD
// ============================================================

const AgentDashboard: FC = () => {
  const { user } = useAuthStore()
  const toast = useToast()
  const queryClient = useQueryClient()

  const structureId = user?.structure_id

  const [currentTicket, setCurrentTicket] = useState<{
    uuid: string
    number: number
    type_name: string
    wait_time_seconds?: number
  } | null>(null)
  const [serviceStartTime, setServiceStartTime] = useState<number | null>(null)

  const { data: queueData, isLoading } = useQuery({
    queryKey: ['queue', structureId],
    queryFn: () => (structureId ? api.getQueue(structureId) : Promise.resolve({ queue: [], queue_length: 0 })),
    enabled: !!structureId,
    refetchInterval: 15_000,
  })

  const callNextMutation = useMutation({
    mutationFn: () => api.callNext(structureId!),
    onSuccess: (data) => {
      if (data.ticket) {
        setCurrentTicket(data.ticket)
        setServiceStartTime(Date.now())
        toast.success(`Ticket #${data.ticket.number} appelé`, data.ticket.type_name)
        queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
      } else {
        toast.info('File vide', 'Aucun ticket en attente')
      }
    },
    onError: () => toast.error('Erreur', 'Impossible d\'appeler le prochain ticket'),
  })

  const completeMutation = useMutation({
    mutationFn: () => {
      const serviceTime = serviceStartTime ? (Date.now() - serviceStartTime) / 1000 : undefined
      return api.completeService(structureId!, serviceTime)
    },
    onSuccess: () => {
      toast.success('Service terminé', 'Ticket marqué comme servi')
      setCurrentTicket(null)
      setServiceStartTime(null)
      queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
    },
    onError: () => toast.error('Erreur', 'Impossible de terminer le service'),
  })

  const { connected } = useWebSocket(structureId, () => {
    queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
  })

  const queue = queueData?.queue || []
  const nextTicket = queue[0] || null

  if (!structureId) {
    return (
      <AppShell>
        <PageHeader title="Dashboard Agent" />
        <div className="page-content">
          <div className="empty-state">
            <AlertTriangle />
            <h3>Aucune structure assignée</h3>
            <p>Demandez à votre administrateur de vous assigner à une structure.</p>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <PageHeader
        title="Dashboard Agent"
        subtitle={`Structure : ${structureId}`}
        actions={
          <div className="connection-status">
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{connected ? 'Connecté' : 'Déconnecté'}</span>
          </div>
        }
      />

      <div className="page-content">
        <div className="stats-grid">
          <StatWidget label="En attente" value={queue.length} icon={<Timer size={20} />} color="#f59e0b" />
          <StatWidget
            label="Prochain ticket"
            value={nextTicket ? `#${nextTicket.number}` : '—'}
            icon={<Hash size={20} />}
            color="#10b981"
            subtitle={nextTicket?.type_name}
          />
          <StatWidget
            label="En cours"
            value={currentTicket ? `#${currentTicket.number}` : '—'}
            icon={<Play size={20} />}
            color="#10b981"
            subtitle={currentTicket?.type_name}
          />
          <StatWidget
            label="Attente estimée"
            value={nextTicket ? formatDuration(nextTicket.estimated_wait) : '—'}
            icon={<Clock size={20} />}
            color="#059669"
            subtitle="Pour le prochain ticket"
          />
        </div>

        <div className="agent-actions-grid">
          <motion.div className="card card-actions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="card-header">
              <div className="card-title">Actions</div>
            </div>
            <div className="card-body card-body--actions">
              <motion.button
                className="btn btn-primary btn-block btn-lg"
                onClick={() => callNextMutation.mutate()}
                disabled={callNextMutation.isPending || (!!currentTicket && !completeMutation.isPending)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {callNextMutation.isPending ? (
                  <div className="spinner" />
                ) : (
                  <>
                    <SkipForward size={20} />
                    Appeler le suivant
                  </>
                )}
              </motion.button>

              <motion.button
                className="btn btn-success btn-block btn-lg"
                onClick={() => completeMutation.mutate()}
                disabled={!currentTicket || completeMutation.isPending}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {completeMutation.isPending ? (
                  <div className="spinner" />
                ) : (
                  <>
                    <CheckCircle size={20} />
                    Service terminé
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>

          <motion.div
            className="card card-ticket"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="card-header">
              <div className="card-title">Ticket en cours</div>
              {currentTicket && (
                <div className="live-indicator">
                  <div className="live-dot" />
                  <span>En service</span>
                </div>
              )}
            </div>
            <div className="card-body card-body--ticket">
              {currentTicket ? (
                <motion.div
                  className="current-ticket-display"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={currentTicket.uuid}
                >
                  <div className="current-ticket-number">#{currentTicket.number}</div>
                  <div className="current-ticket-type">{currentTicket.type_name}</div>
                  {serviceStartTime && <ServiceTimer startTime={serviceStartTime} />}
                </motion.div>
              ) : (
                <div className="no-ticket-display">
                  <Pause size={32} />
                  <p>Aucun ticket en cours</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="card-header">
            <div>
              <div className="card-title">File d'attente</div>
              <div className="card-subtitle">{queue.length} tickets en attente</div>
            </div>
          </div>
          {isLoading ? (
            <div className="table-loader">
              <div className="spinner" />
            </div>
          ) : queue.length === 0 ? (
            <div className="empty-state">
              <CheckCircle />
              <h3>File vide</h3>
              <p>Tous les clients ont été servis !</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pos.</th>
                    <th>Ticket</th>
                    <th>Type</th>
                    <th>Priorité</th>
                    <th>Attente est.</th>
                    <th>Créé à</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((ticket, idx) => (
                    <tr key={ticket.uuid}>
                      <td>
                        <span className={`position-badge ${idx === 0 ? 'position-badge--first' : ''}`}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td>
                        <span className="ticket-number">#{ticket.number}</span>
                      </td>
                      <td>
                        <span className="badge badge-ghost">{ticket.type_name}</span>
                      </td>
                      <td>
                        <div className="priority-indicator">
                          <div className="priority-dot" style={{ background: getPriorityColor(ticket.priority_value) }} />
                          <span style={{ color: getPriorityColor(ticket.priority_value) }}>P{ticket.priority_value}</span>
                        </div>
                      </td>
                      <td className="table-cell-mono">{formatDuration(ticket.estimated_wait)}</td>
                      <td className="table-cell-mono">{new Date(ticket.created_at).toLocaleTimeString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </AppShell>
  )
}

const ServiceTimer: FC<{ startTime: number }> = ({ startTime }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  return (
    <div className="service-timer">
      <Timer size={12} />
      <span>{formatDuration(elapsed)}</span>
    </div>
  )
}

// ============================================================
// STRUCTURES PAGE
// ============================================================

const StructuresPage: FC = () => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [createModal, setCreateModal] = useState(false)
  const [editModal, setEditModal] = useState<Structure | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Structure | null>(null)
  const [configModal, setConfigModal] = useState<Structure | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['structures'],
    queryFn: api.getStructures,
    refetchInterval: 15_000,
  })

  const structures = data?.structures || []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteStructure(id),
    onSuccess: () => {
      toast.success('Structure supprimée')
      queryClient.invalidateQueries({ queryKey: ['structures'] })
      setDeleteConfirm(null)
    },
    onError: () => toast.error('Erreur', 'Impossible de supprimer la structure'),
  })

  return (
    <AppShell>
      <PageHeader
        title="Structures"
        subtitle={`${structures.length} structure${structures.length !== 1 ? 's' : ''} enregistrée${structures.length !== 1 ? 's' : ''}`}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
            <Plus size={14} />
            Nouvelle structure
          </button>
        }
      />

      <div className="page-content">
        {isLoading ? (
          <div className="loading-screen">
            <div className="spinner spinner-lg" />
          </div>
        ) : structures.length === 0 ? (
          <div className="empty-state">
            <Building2 />
            <h3>Aucune structure</h3>
            <p>Créez votre première structure pour commencer la gestion des files</p>
            <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => setCreateModal(true)}>
              <Plus size={16} />
              Créer une structure
            </button>
          </div>
        ) : (
          <div className="structures-grid">
            {structures.map((structure, i) => (
              <motion.div
                key={structure.id}
                className="structure-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -4 }}
              >
                <div className="structure-card-header">
                  <div className="structure-card-avatar">
                    <Building2 size={18} />
                  </div>
                  <div className="structure-card-info">
                    <h3 className="structure-card-name">{structure.name}</h3>
                    <span className={`badge ${structure.is_active ? 'badge-success' : 'badge-ghost'}`}>
                      {structure.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </div>
                  <div className="structure-card-actions">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfigModal(structure)} title="Configurer">
                      <SlidersHorizontal size={14} />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditModal(structure)}>
                      <Edit size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm btn-danger"
                      onClick={() => setDeleteConfirm(structure)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="structure-card-body">
                  {structure.description && (
                    <p className="structure-card-desc">{structure.description}</p>
                  )}

                  <div className="structure-card-stats">
                    <div className="structure-stat">
                      <div
                        className={`structure-stat-value ${
                          structure.current_queue_length > 10
                            ? 'structure-stat-value--danger'
                            : structure.current_queue_length > 5
                            ? 'structure-stat-value--warning'
                            : 'structure-stat-value--success'
                        }`}
                      >
                        {structure.current_queue_length}
                      </div>
                      <div className="structure-stat-label">tickets en file</div>
                    </div>
                    <div className="structure-stat">
                      <div className="structure-stat-value structure-stat-value--primary">
                        α{structure.config.alpha}
                      </div>
                      <div className="structure-stat-label">coefficient priorité</div>
                    </div>
                  </div>

                  <div className="structure-card-meta">
                    {structure.address && (
                      <span className="structure-meta-item">
                        <MapPin size={12} />
                        {structure.address.substring(0, 25)}...
                      </span>
                    )}
                    {structure.phone && (
                      <span className="structure-meta-item">
                        <Phone size={12} />
                        {structure.phone}
                      </span>
                    )}
                  </div>
                </div>

                <div className="structure-card-footer">
                  <Link to={`/queue/${structure.id}`} className="structure-footer-link">
                    <button className="btn btn-secondary btn-sm btn-block">
                      <Eye size={14} />
                      Voir la file
                    </button>
                  </Link>
                  <Link to={`/statistics?structure=${structure.id}`} className="structure-footer-link">
                    <button className="btn btn-ghost btn-sm btn-block">
                      <BarChart3 size={14} />
                      Stats
                    </button>
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <StructureFormModal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['structures'] })
          setCreateModal(false)
          toast.success('Structure créée')
        }}
      />

      {editModal && (
        <StructureFormModal
          isOpen={!!editModal}
          onClose={() => setEditModal(null)}
          structure={editModal}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['structures'] })
            setEditModal(null)
            toast.success('Structure mise à jour')
          }}
        />
      )}

      {configModal && (
        <StructureConfigModal
          isOpen={!!configModal}
          onClose={() => setConfigModal(null)}
          structure={configModal}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['structures'] })
            setConfigModal(null)
            toast.success('Configuration mise à jour')
          }}
        />
      )}

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer la structure"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Annuler</button>
            <button
              className="btn btn-danger"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <div className="spinner" /> : 'Supprimer'}
            </button>
          </>
        }
      >
        <p className="modal-confirm-text">
          Êtes-vous sûr de vouloir supprimer{' '}
          <strong>{deleteConfirm?.name}</strong>{' '}
          ? Cette action est irréversible. Tous les agents associés perdront leur
          rattachement.
        </p>
      </Modal>
    </AppShell>
  )
}

// ============================================================
// STRUCTURE FORM MODAL
// ============================================================

interface StructureFormModalProps {
  isOpen: boolean
  onClose: () => void
  structure?: Structure
  onSuccess: () => void
}

const StructureFormModal: FC<StructureFormModalProps> = ({
  isOpen,
  onClose,
  structure,
  onSuccess,
}) => {
  const toast = useToast()
  const [form, setForm] = useState({
    name: structure?.name || '',
    description: structure?.description || '',
    address: structure?.address || '',
    phone: structure?.phone || '',
    is_active: structure?.is_active ?? true,
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (structure) {
      setForm({
        name: structure.name,
        description: structure.description || '',
        address: structure.address || '',
        phone: structure.phone || '',
        is_active: structure.is_active,
      })
    } else {
      setForm({ name: '', description: '', address: '', phone: '', is_active: true })
    }
  }, [structure, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (structure) {
        await api.updateStructure(structure.id, form)
      } else {
        await api.createStructure(form)
      }
      onSuccess()
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      toast.error('Erreur', axiosError.response?.data?.detail || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={structure ? 'Modifier la structure' : 'Nouvelle structure'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={loading}
          >
            {loading ? <div className="spinner" /> : structure ? 'Modifier' : 'Créer'}
          </button>
        </>
      }
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Nom *</label>
          <input
            type="text"
            className="form-input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            minLength={2}
            placeholder="Guichet principal"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description de la structure..."
            rows={3}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              <MapPin size={12} />
              Adresse
            </label>
            <input
              type="text"
              className="form-input"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="123 rue de la Paix"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              <Phone size={12} />
              Téléphone
            </label>
            <input
              type="tel"
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="01 23 45 67 89"
            />
          </div>
        </div>

        {structure && (
          <div className="form-group">
            <label className="form-label">Statut</label>
            <div className="status-toggle">
              <button
                type="button"
                className={`btn btn-sm ${form.is_active ? 'btn-success' : 'btn-ghost'}`}
                onClick={() => setForm((f) => ({ ...f, is_active: true }))}
              >
                <CheckCircle size={14} /> Actif
              </button>
              <button
                type="button"
                className={`btn btn-sm ${!form.is_active ? 'btn-danger' : 'btn-ghost'}`}
                onClick={() => setForm((f) => ({ ...f, is_active: false }))}
              >
                <X size={14} /> Inactif
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}

// ============================================================
// STRUCTURE CONFIG MODAL
// ============================================================

interface StructureConfigModalProps {
  isOpen: boolean
  onClose: () => void
  structure: Structure
  onSuccess: () => void
}

const StructureConfigModal: FC<StructureConfigModalProps> = ({
  isOpen,
  onClose,
  structure,
  onSuccess,
}) => {
  const toast = useToast()
  const [config, setConfig] = useState({
    alpha: structure.config.alpha,
    beta: structure.config.beta,
    t_ref: structure.config.t_ref,
    ticket_ttl: structure.config.ticket_ttl,
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await api.updateStructureConfig(structure.id, config)
      onSuccess()
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      toast.error('Erreur', axiosError.response?.data?.detail || 'Configuration non mise à jour')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Algorithme — ${structure.name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <div className="spinner" /> : 'Appliquer'}
          </button>
        </>
      }
    >
      <div className="config-formula">
        <p className="config-formula-main">Score = α × priorité + β × t_normalisé</p>
        <p className="config-formula-sub">t_norm = (maintenant - créé_à) / (t_ref × 1000)</p>
      </div>

      <div className="config-grid">
        <div className="form-group">
          <label className="form-label">Alpha (α) — Poids priorité</label>
          <input
            type="number"
            className="form-input"
            value={config.alpha}
            onChange={(e) => setConfig((c) => ({ ...c, alpha: parseFloat(e.target.value) }))}
            step="0.1"
            min="0"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Beta (β) — Poids temps</label>
          <input
            type="number"
            className="form-input"
            value={config.beta}
            onChange={(e) => setConfig((c) => ({ ...c, beta: parseFloat(e.target.value) }))}
            step="0.1"
            min="0"
          />
        </div>

        <div className="form-group">
          <label className="form-label">T_ref (secondes)</label>
          <input
            type="number"
            className="form-input"
            value={config.t_ref}
            onChange={(e) => setConfig((c) => ({ ...c, t_ref: parseInt(e.target.value) }))}
            min="60"
          />
          <span className="form-hint">Temps de référence pour la normalisation</span>
        </div>

        <div className="form-group">
          <label className="form-label">TTL ticket (secondes)</label>
          <input
            type="number"
            className="form-input"
            value={config.ticket_ttl}
            onChange={(e) => setConfig((c) => ({ ...c, ticket_ttl: parseInt(e.target.value) }))}
            min="300"
            max="86400"
          />
          <span className="form-hint">Durée avant expiration automatique</span>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// AGENTS PAGE
// ============================================================

const AgentsPage: FC = () => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [createModal, setCreateModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Agent | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
    refetchInterval: 30_000,
  })

  const { data: structuresData } = useQuery({
    queryKey: ['structures'],
    queryFn: api.getStructures,
  })

  const agents = agentsData?.agents || []
  const structures = structuresData?.structures || []

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteAgent(id),
    onSuccess: () => {
      toast.success('Agent supprimé')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setDeleteConfirm(null)
    },
    onError: () => toast.error('Erreur', 'Impossible de supprimer l\'agent'),
  })

  const getStructureName = (id?: string) => {
    if (!id) return 'Non assigné'
    return structures.find((s) => s.id === id)?.name || id
  }

  return (
    <AppShell>
      <PageHeader
        title="Agents"
        subtitle={`${agents.length} agent${agents.length !== 1 ? 's' : ''} enregistré${agents.length !== 1 ? 's' : ''}`}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
            <Plus size={14} />
            Nouvel agent
          </button>
        }
      />

      <div className="page-content">
        <div className="toolbar">
          <div className="search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              className="form-input"
              placeholder="Rechercher un agent..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="loading-screen">
            <div className="spinner spinner-lg" />
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="empty-state">
            <Users />
            <h3>Aucun agent trouvé</h3>
            <p>
              {searchTerm ? 'Aucun résultat pour cette recherche' : 'Créez votre premier agent pour commencer'}
            </p>
            {!searchTerm && (
              <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => setCreateModal(true)}>
                <Plus size={16} />
                Créer un agent
              </button>
            )}
          </div>
        ) : (
          <motion.div className="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Email</th>
                    <th>Structure</th>
                    <th>Statut</th>
                    <th>Créé le</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent, i) => (
                    <motion.tr key={agent.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                      <td>
                        <div className="agent-cell">
                          <div className="agent-avatar">{agent.name.charAt(0).toUpperCase()}</div>
                          <span className="agent-name">{agent.name}</span>
                        </div>
                      </td>
                      <td className="table-cell-mono">{agent.email}</td>
                      <td>
                        {agent.structure_id ? (
                          <span className="badge badge-primary">
                            <Building2 size={10} />
                            {getStructureName(agent.structure_id).substring(0, 20)}
                          </span>
                        ) : (
                          <span className="badge badge-ghost">Non assigné</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${agent.is_active ? 'badge-success' : 'badge-danger'}`}>
                          {agent.is_active ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="table-cell-mono">{formatDate(agent.created_at)}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-icon btn-sm btn-danger"
                          onClick={() => setDeleteConfirm(agent)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>

      <AgentFormModal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        structures={structures}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['agents'] })
          setCreateModal(false)
          toast.success('Agent créé')
        }}
      />

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer l'agent"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Annuler</button>
            <button
              className="btn btn-danger"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <div className="spinner" /> : 'Supprimer'}
            </button>
          </>
        }
      >
        <p className="modal-confirm-text">
          Voulez-vous vraiment supprimer l'agent <strong>{deleteConfirm?.name}</strong> ?
          Cette action est irréversible.
        </p>
      </Modal>
    </AppShell>
  )
}

// Agent Form Modal
interface AgentFormModalProps {
  isOpen: boolean
  onClose: () => void
  structures: Structure[]
  onSuccess: () => void
}

const AgentFormModal: FC<AgentFormModalProps> = ({ isOpen, onClose, structures, onSuccess }) => {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '', structure_id: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setForm({ name: '', email: '', password: '', structure_id: '' })
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.createAgent(form.name, form.email, form.password, form.structure_id || undefined)
      onSuccess()
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      toast.error('Erreur', axiosError.response?.data?.detail || 'Impossible de créer l\'agent')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nouvel agent"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSubmit as unknown as React.MouseEventHandler} disabled={loading}>
            {loading ? <div className="spinner" /> : 'Créer l\'agent'}
          </button>
        </>
      }
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Nom complet *</label>
          <input
            type="text"
            className="form-input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            minLength={2}
            placeholder="Marie Martin"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Email *</label>
          <input
            type="email"
            className="form-input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
            placeholder="marie@exemple.com"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Mot de passe *</label>
          <input
            type="password"
            className="form-input"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
            minLength={8}
            placeholder="Min. 8 caractères"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Structure assignée</label>
          <select
            className="form-select"
            value={form.structure_id}
            onChange={(e) => setForm((f) => ({ ...f, structure_id: e.target.value }))}
          >
            <option value="">— Aucune structure —</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  )
}

// ============================================================
// QUEUE MANAGEMENT PAGE
// ============================================================

const QueuePage: FC = () => {
  const { user } = useAuthStore()
  const params = useLocation()
  const toast = useToast()
  const queryClient = useQueryClient()

  const pathStructureId = params.pathname.split('/queue/')[1]
  const structureId = pathStructureId || user?.structure_id || ''

  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'position' | 'priority' | 'time'>('position')
  const [filterPriority, setFilterPriority] = useState<number | null>(null)
  const [updateTypeModal, setUpdateTypeModal] = useState<QueueTicket | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<QueueTicket | null>(null)
  const [newTicketModal, setNewTicketModal] = useState(false)

  const { data: queueData, isLoading } = useQuery({
    queryKey: ['queue', structureId],
    queryFn: () => api.getQueue(structureId),
    enabled: !!structureId,
    refetchInterval: 10_000,
  })

  const { data: typesData } = useQuery({
    queryKey: ['types', structureId],
    queryFn: () => api.getStructureTypes(structureId),
    enabled: !!structureId,
  })

  const { connected } = useWebSocket(structureId, () => {
    queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
  })

  const callNextMutation = useMutation({
    mutationFn: () => api.callNext(structureId),
    onSuccess: (data) => {
      if (data.ticket) {
        toast.success(`Ticket #${data.ticket.number} appelé`)
      } else {
        toast.info('File vide')
      }
      queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
    },
    onError: () => toast.error('Erreur', 'Impossible d\'appeler le prochain ticket'),
  })

  const deleteTicketMutation = useMutation({
    mutationFn: (uuid: string) => api.deleteTicket(uuid),
    onSuccess: () => {
      toast.success('Ticket supprimé')
      queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
      setDeleteConfirm(null)
    },
    onError: () => toast.error('Erreur', 'Impossible de supprimer le ticket'),
  })

  const createTicketMutation = useMutation({
    mutationFn: (type_index: number) => api.createTicket(structureId, type_index),
    onSuccess: (data) => {
      toast.success(`Ticket #${data.ticket.number} créé`, `Position: ${data.position}`)
      queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
      setNewTicketModal(false)
    },
    onError: () => toast.error('Erreur', 'Impossible de créer le ticket'),
  })

  const queue = queueData?.queue || []
  const types: StructureType[] = typesData?.types || []

  const filteredQueue = useMemo(() => {
    let result = [...queue]

    if (searchTerm) {
      result = result.filter(
        (t) =>
          t.number.toString().includes(searchTerm) ||
          t.type_name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    if (filterPriority !== null) {
      result = result.filter((t) => t.priority_value === filterPriority)
    }

    if (sortBy === 'priority') {
      result.sort((a, b) => b.priority_value - a.priority_value)
    } else if (sortBy === 'time') {
      result.sort((a, b) => a.created_at - b.created_at)
    }

    return result
  }, [queue, searchTerm, filterPriority, sortBy])

  const stats = useMemo(() => {
    const byPriority: Record<number, number> = {}
    queue.forEach((t) => {
      byPriority[t.priority_value] = (byPriority[t.priority_value] || 0) + 1
    })
    return {
      total: queue.length,
      byPriority,
      avgWait: queue.reduce((acc, t) => acc + t.estimated_wait, 0) / (queue.length || 1),
    }
  }, [queue])

  // Helper function to build tracking URL
  const buildTrackingUrl = (ticketUuid: string): string => {
    return `${window.location.origin}/track/${ticketUuid}`
  }

  // Handler for copying tracking link
  const handleCopyTrackingLink = (ticketUuid: string) => {
    const url = buildTrackingUrl(ticketUuid)
    navigator.clipboard.writeText(url)
    toast.success('Lien copié', 'Le lien de suivi a été copié dans le presse-papiers')
  }

  if (!structureId) {
    return (
      <AppShell>
        <PageHeader title="File d'attente" />
        <div className="page-content">
          <div className="empty-state">
            <AlertTriangle />
            <h3>Aucune structure sélectionnée</h3>
            <p>Sélectionnez une structure dans la liste des structures</p>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <PageHeader
        title="File d'attente"
        subtitle={`Structure : ${structureId} · ${queue.length} tickets`}
        actions={
          <div className="page-header-actions-group">
            <div className="connection-status">
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{connected ? 'Live' : 'Offline'}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setNewTicketModal(true)}>
              <Plus size={14} />
              Ticket
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => callNextMutation.mutate()}
              disabled={callNextMutation.isPending || queue.length === 0}
            >
              {callNextMutation.isPending ? (
                <div className="spinner" />
              ) : (
                <>
                  <SkipForward size={14} />
                  Appeler suivant
                </>
              )}
            </button>
          </div>
        }
      />

      <div className="page-content">
        <div className="stats-grid">
          <StatWidget label="Total en file" value={stats.total} icon={<Ticket size={18} />} color="#10b981" />
          <StatWidget label="Priorité standard" value={stats.byPriority[1] || 0} icon={<ArrowUpDown size={18} />} color="#64748b" />
          <StatWidget label="Priorité haute" value={stats.byPriority[2] || 0} icon={<ChevronUp size={18} />} color="#f59e0b" />
          <StatWidget label="Urgents" value={stats.byPriority[3] || 0} icon={<AlertTriangle size={18} />} color="#ef4444" />
        </div>

        <div className="toolbar">
          <div className="search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              className="form-input"
              placeholder="N° ticket, type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="form-select form-select--auto"
            value={filterPriority ?? ''}
            onChange={(e) => setFilterPriority(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">Toutes priorités</option>
            <option value="1">Standard (P1)</option>
            <option value="2">Prioritaire (P2)</option>
            <option value="3">Urgent (P3)</option>
          </select>

          <select
            className="form-select form-select--auto"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="position">Trier par position</option>
            <option value="priority">Trier par priorité</option>
            <option value="time">Trier par heure</option>
          </select>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearchTerm('')
              setFilterPriority(null)
              setSortBy('position')
            }}
          >
            <RefreshCw size={14} />
            Reset
          </button>
        </div>

        <motion.div className="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {isLoading ? (
            <div className="table-loader">
              <div className="spinner spinner-lg" />
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="empty-state">
              <CheckCircle />
              <h3>File vide</h3>
              <p>
                {searchTerm || filterPriority !== null
                  ? 'Aucun ticket ne correspond à vos filtres'
                  : 'Aucun ticket en attente pour le moment'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>N° Ticket</th>
                    <th>Type</th>
                    <th>Priorité</th>
                    <th>Attente est.</th>
                    <th>Créé à</th>
                    <th>UUID</th>
                    <th>Suivi</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {filteredQueue.map((ticket, idx) => (
                      <motion.tr
                        key={ticket.uuid}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ delay: idx * 0.02 }}
                      >
                        <td>
                          <span className={`position-badge ${ticket.position === 1 ? 'position-badge--first' : ''}`}>
                            #{ticket.position}
                          </span>
                        </td>
                        <td>
                          <span className="ticket-number ticket-number--large">{ticket.number}</span>
                        </td>
                        <td>
                          <span className="badge badge-ghost">{ticket.type_name}</span>
                        </td>
                        <td>
                          <span className={`badge ${getPriorityBadgeClass(ticket.priority_value)}`}>
                            <div className="priority-dot" style={{ background: getPriorityColor(ticket.priority_value) }} />
                            P{ticket.priority_value}
                          </span>
                        </td>
                        <td>
                          <span className={`wait-time ${ticket.estimated_wait > 600 ? 'wait-time--danger' : ''}`}>
                            {formatDuration(ticket.estimated_wait)}
                          </span>
                        </td>
                        <td className="table-cell-mono">{new Date(ticket.created_at).toLocaleTimeString('fr-FR')}</td>
                        <td>
                          <span
                            className="uuid-cell"
                            onClick={() => navigator.clipboard.writeText(ticket.uuid)}
                            title="Cliquer pour copier"
                          >
                            {ticket.uuid.substring(0, 8)}...
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <Link
                              to={`/track/${ticket.uuid}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                title="Ouvrir la page de suivi"
                              >
                                <ExternalLink size={13} />
                              </button>
                            </Link>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => handleCopyTrackingLink(ticket.uuid)}
                              title="Copier le lien de suivi"
                            >
                              <Copy size={13} />
                            </button>
                            <Link
                              to={`/track/${ticket.uuid}`}
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                            >
                              Suivi
                            </Link>
                          </div>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => setUpdateTypeModal(ticket)}
                              title="Changer le type"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              className="btn btn-ghost btn-icon btn-sm btn-danger"
                              onClick={() => setDeleteConfirm(ticket)}
                              title="Supprimer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      <Modal isOpen={newTicketModal} onClose={() => setNewTicketModal(false)} title="Créer un ticket">
        <div className="ticket-type-list">
          <p className="ticket-type-list-intro">Sélectionnez le type de ticket à créer :</p>
          {types.map((type, index) => (
            <motion.button
              key={index}
              className="btn btn-secondary btn-block ticket-type-btn"
              onClick={() => createTicketMutation.mutate(index)}
              disabled={createTicketMutation.isPending}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <span>{type.name}</span>
              <span className={`badge ${type.priority === 1 ? 'badge-ghost' : type.priority === 2 ? 'badge-warning' : 'badge-danger'}`}>
                Priorité {type.priority}
              </span>
            </motion.button>
          ))}
          {types.length === 0 && (
            <p className="empty-types">Aucun type de ticket configuré pour cette structure</p>
          )}
        </div>
      </Modal>

      {updateTypeModal && (
        <UpdateTicketTypeModal
          isOpen={!!updateTypeModal}
          onClose={() => setUpdateTypeModal(null)}
          ticket={updateTypeModal}
          types={types}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['queue', structureId] })
            setUpdateTypeModal(null)
            toast.success('Type mis à jour')
          }}
        />
      )}

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Supprimer le ticket"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Annuler</button>
            <button
              className="btn btn-danger"
              onClick={() => deleteConfirm && deleteTicketMutation.mutate(deleteConfirm.uuid)}
              disabled={deleteTicketMutation.isPending}
            >
              {deleteTicketMutation.isPending ? <div className="spinner" /> : 'Supprimer'}
            </button>
          </>
        }
      >
        <p className="modal-confirm-text">
          Voulez-vous supprimer le ticket <strong>#{deleteConfirm?.number}</strong> ({deleteConfirm?.type_name}) ?
        </p>
      </Modal>
    </AppShell>
  )
}

// Update ticket type modal
interface UpdateTicketTypeModalProps {
  isOpen: boolean
  onClose: () => void
  ticket: QueueTicket
  types: StructureType[]
  onSuccess: () => void
}

const UpdateTicketTypeModal: FC<UpdateTicketTypeModalProps> = ({
  isOpen,
  onClose,
  ticket,
  types,
  onSuccess,
}) => {
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const handleUpdate = async (typeIndex: number) => {
    setLoading(true)
    try {
      await api.updateTicketType(ticket.uuid, typeIndex)
      onSuccess()
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail: string }>
      toast.error('Erreur', axiosError.response?.data?.detail || 'Mise à jour impossible')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Modifier ticket #${ticket.number}`}>
      <p className="current-type-label">
        Type actuel : <span className="badge badge-ghost">{ticket.type_name}</span>
      </p>
      <div className="ticket-type-list">
        {types.map((type, index) => (
          <button
            key={index}
            className={`btn btn-block ${index === ticket.type_index ? 'btn-primary' : 'btn-secondary'} ticket-type-btn`}
            onClick={() => handleUpdate(index)}
            disabled={loading || index === ticket.type_index}
          >
            <span>{type.name}</span>
            <span className="badge badge-ghost">Priorité {type.priority}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ============================================================
// STATISTICS PAGE
// ============================================================

const StatisticsPage: FC = () => {
  const { user } = useAuthStore()
  const location = useLocation()
  const isAdmin = user?.role === 'ADMIN'

  const urlParams = new URLSearchParams(location.search)
  const defaultStructureId = urlParams.get('structure') || user?.structure_id || ''

  const [selectedStructure, setSelectedStructure] = useState(defaultStructureId)
  const [days, setDays] = useState(30)

  const { data: structuresData } = useQuery({
    queryKey: ['structures'],
    queryFn: api.getStructures,
    enabled: isAdmin,
  })

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', selectedStructure, days],
    queryFn: () => api.getStructureStats(selectedStructure, days),
    enabled: !!selectedStructure,
    refetchInterval: 60_000,
  })

  const structures = structuresData?.structures || []
  const statistics = stats?.statistics || []

  const chartData = [...statistics].reverse().map((s) => ({
    date: new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    créés: s.tickets_created,
    servis: s.tickets_served,
    expirés: s.tickets_expired,
    attente_moy: Math.round(s.avg_wait_time),
    service_moy: Math.round(s.avg_service_time),
  }))

  const exportCSV = () => {
    if (!stats) return
    const rows = [
      ['Date', 'Créés', 'Servis', 'Expirés', 'Attente moy.', 'Service moy.'],
      ...statistics.map((s) => [
        s.date,
        s.tickets_created,
        s.tickets_served,
        s.tickets_expired,
        s.avg_wait_time,
        s.avg_service_time,
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `stats-${selectedStructure}-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  return (
    <AppShell>
      <PageHeader
        title="Statistiques"
        subtitle="Analytics et performances"
        actions={
          stats && (
            <button className="btn btn-secondary btn-sm" onClick={exportCSV}>
              <Download size={14} />
              Export CSV
            </button>
          )
        }
      />

      <div className="page-content">
        <div className="stats-filters-card">
          <div className="stats-filters">
            {isAdmin && (
              <div className="form-group">
                <label className="form-label">Structure</label>
                <select
                  className="form-select"
                  value={selectedStructure}
                  onChange={(e) => setSelectedStructure(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  {structures.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Période</label>
              <div className="period-toggle">
                {[7, 14, 30, 90].map((d) => (
                  <button
                    key={d}
                    className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setDays(d)}
                  >
                    {d}j
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {!selectedStructure ? (
          <div className="empty-state">
            <BarChart3 />
            <h3>Sélectionnez une structure</h3>
            <p>Choisissez une structure pour afficher ses statistiques</p>
          </div>
        ) : isLoading ? (
          <div className="loading-screen">
            <div className="spinner spinner-lg" />
          </div>
        ) : (
          <>
            <div className="stats-grid">
              <StatWidget
                label="Tickets créés"
                value={statistics.reduce((a, s) => a + s.tickets_created, 0)}
                icon={<Plus size={18} />}
                color="#10b981"
                subtitle={`${days} derniers jours`}
              />
              <StatWidget
                label="Tickets servis"
                value={statistics.reduce((a, s) => a + s.tickets_served, 0)}
                icon={<CheckCircle size={18} />}
                color="#10b981"
              />
              <StatWidget
                label="File actuelle"
                value={stats?.current_queue_length || 0}
                icon={<Ticket size={18} />}
                color="#f59e0b"
                subtitle="En ce moment"
              />
              <StatWidget
                label="Temps service moy."
                value={formatDuration(stats?.average_service_time || 0)}
                icon={<Clock size={18} />}
                color="#059669"
              />
            </div>

            <motion.div
              className="card card-chart"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="card-header">
                <div>
                  <div className="card-title">Volume de tickets</div>
                  <div className="card-subtitle">Créés vs servis sur {days} jours</div>
                </div>
              </div>
              <div className="card-body">
                {chartData.length === 0 ? (
                  <div className="empty-state empty-state--chart">
                    <TrendingUp />
                    <h3>Pas encore de données</h3>
                    <p>Les statistiques s'accumuleront avec l'usage</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradServed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 8,
                          color: 'var(--text-primary)',
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="créés" stroke="#10b981" fill="url(#gradCreated)" strokeWidth={2} />
                      <Area type="monotone" dataKey="servis" stroke="#059669" fill="url(#gradServed)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </motion.div>

            <motion.div
              className="card card-chart"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="card-header">
                <div>
                  <div className="card-title">Temps d'attente & de service</div>
                  <div className="card-subtitle">Moyennes en secondes</div>
                </div>
              </div>
              <div className="card-body">
                {chartData.length === 0 ? (
                  <div className="empty-state empty-state--chart">
                    <Clock />
                    <p>Pas encore de données de temps</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 8,
                          color: 'var(--text-primary)',
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [formatDuration(value), '']}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="attente_moy" stroke="#f59e0b" strokeWidth={2} dot={false} name="Attente moy." />
                      <Line type="monotone" dataKey="service_moy" stroke="#059669" strokeWidth={2} dot={false} name="Service moy." />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </AppShell>
  )
}

// ============================================================
// DISPLAY PAGE
// ============================================================

const DisplayPage: FC = () => {
  const location = useLocation()
  const { user } = useAuthStore()
  const urlParams = new URLSearchParams(location.search)
  const structureIdParam = urlParams.get('structure')
  const structureId = structureIdParam || user?.structure_id || ''

  const [recentTickets, setRecentTickets] = useState<
    { number: number; type_name: string; called_at: number }[]
  >([])

  const { connected, lastCalled } = useDisplaySocket(structureId || undefined)

  const { data: currentTicketData } = useQuery({
    queryKey: ['current-ticket', structureId],
    queryFn: () => api.getCurrentTicket(structureId),
    enabled: !!structureId,
    refetchInterval: 15_000,
  })

  const displayedTicket = lastCalled || currentTicketData?.ticket || null

  const playSound = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
    } catch {
      // AudioContext not available
    }
  }, [])

  useEffect(() => {
    if (lastCalled) {
      playSound()
      setRecentTickets((prev) => [
        { ...lastCalled, called_at: Date.now() },
        ...prev.slice(0, 4),
      ])
    }
  }, [lastCalled, playSound])

  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.()
  }

  if (!structureId) {
    return (
      <div className="display-screen display-screen--centered">
        <div className="display-empty">
          <Monitor size={48} />
          <h2>Écran d'affichage</h2>
          <p>Ajoutez <code>?structure=ID</code> à l'URL pour afficher une structure</p>
          <Link to="/structures">
            <button className="btn btn-primary">Voir les structures</button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="display-screen">
      <div className="display-header">
        <div className="display-header-logo">
          <div className="display-logo-icon">
            <Ticket size={20} />
          </div>
          <div className="display-logo-text">
            <span className="display-brand">QueueMaster</span>
            <span className="display-subtitle">Écran d'affichage</span>
          </div>
        </div>

        <div className="display-header-info">
          <div className="display-clock">
            {time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>

          <div className="display-header-status">
            <div className={`connection-indicator ${connected ? 'connected' : ''}`}>
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{connected ? 'Connecté' : 'Hors ligne'}</span>
            </div>
            <button className="display-fullscreen-btn" onClick={goFullscreen}>
              <Maximize size={14} />
              <span>Plein écran</span>
            </button>
          </div>
        </div>
      </div>

      <div className="display-called">
        {displayedTicket ? (
          <motion.div
            key={displayedTicket.number}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 150 }}
            className="display-ticket-wrapper"
          >
            <div className="display-ticket-label">Ticket appelé</div>

            <motion.div
              className="display-ticket-number"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 1, repeat: 2 }}
            >
              {displayedTicket.number.toString().padStart(3, '0')}
            </motion.div>

            <div className="display-ticket-type">{displayedTicket.type_name}</div>

            <div className="display-rings">
              {[1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  className="display-ring"
                  animate={{ scale: [1, 3], opacity: [0.5, 0] }}
                  transition={{ duration: 3, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
                />
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="display-ticket-wrapper">
            <div className="display-ticket-number display-ticket-number--empty">000</div>
            <div className="display-ticket-type display-ticket-type--empty">En attente d'un appel...</div>
          </motion.div>
        )}
      </div>

      {recentTickets.length > 0 && (
        <div className="display-recent">
          <div className="display-recent-label">Derniers appelés</div>
          <div className="display-recent-list">
            <AnimatePresence>
              {recentTickets.map((t, i) => (
                <motion.div
                  key={`${t.number}-${t.called_at}`}
                  className="display-recent-item"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1 - i * 0.15, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ opacity: 1 - i * 0.2 }}
                >
                  <div className="display-recent-number">{t.number.toString().padStart(3, '0')}</div>
                  <div className="display-recent-type">{t.type_name}</div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SETTINGS PAGE
// ============================================================

const SettingsPage: FC = () => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'profile' | 'display' | 'about'>('profile')

  const handleLogout = () => {
    logout()
    toast.info('Déconnecté')
    navigate('/login')
  }

  return (
    <AppShell>
      <PageHeader title="Paramètres" subtitle="Configuration de votre compte" />

      <div className="page-content">
        <div className="settings-layout">
          <div className="settings-nav-card">
            {[
              { id: 'profile', label: 'Profil', icon: <User size={16} /> },
              { id: 'display', label: 'Affichage', icon: <Monitor size={16} /> },
              { id: 'about', label: 'À propos', icon: <Info size={16} /> },
            ].map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id as typeof tab)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="settings-content">
            <AnimatePresence mode="wait">
              {tab === 'profile' && (
                <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">Informations du profil</div>
                    </div>
                    <div className="card-body">
                      <div className="profile-header">
                        <div className="profile-avatar">{user?.name.charAt(0).toUpperCase()}</div>
                        <div className="profile-info">
                          <div className="profile-name">{user?.name}</div>
                          <div className="profile-email">{user?.email}</div>
                          <div className="profile-role">
                            <span className={`badge ${user?.role === 'ADMIN' ? 'badge-primary' : 'badge-success'}`}>
                              {user?.role}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="profile-details">
                        {[
                          { label: 'Identifiant', value: `#${user?.id}` },
                          { label: 'Rôle', value: user?.role },
                          { label: 'Structure', value: user?.structure_id || 'Non assigné' },
                        ].map((field) => (
                          <div key={field.label} className="profile-detail-row">
                            <span className="profile-detail-label">{field.label}</span>
                            <span className="profile-detail-value">{field.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="card-footer">
                      <button className="btn btn-danger btn-sm" onClick={handleLogout}>
                        <LogOut size={14} />
                        Se déconnecter
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {tab === 'display' && (
                <motion.div key="display" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">Écran d'affichage</div>
                    </div>
                    <div className="card-body">
                      <p className="display-url-intro">
                        L'écran d'affichage public est accessible via l'URL suivante :
                      </p>

                      <div className="display-url-box">
                        <span className="display-url">
                          {window.location.origin}/display
                          {user?.structure_id ? `?structure=${user.structure_id}` : '?structure=STRUCTURE_ID'}
                        </span>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/display${user?.structure_id ? `?structure=${user.structure_id}` : ''}`
                            )
                            toast.success('URL copiée')
                          }}
                        >
                          <Copy size={14} />
                        </button>
                      </div>

                      <Link to="/display">
                        <button className="btn btn-primary">
                          <ExternalLink size={14} />
                          Ouvrir l'écran
                        </button>
                      </Link>
                    </div>
                  </div>
                </motion.div>
              )}

              {tab === 'about' && (
                <motion.div key="about" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">À propos</div>
                    </div>
                    <div className="card-body">
                      <div className="about-header">
                        <div className="about-logo">
                          <Ticket size={26} />
                        </div>
                        <div className="about-info">
                          <div className="about-name">QueueMaster</div>
                          <div className="about-version">Version 1.0.0 — Gestion intelligente des files</div>
                        </div>
                      </div>

                      <div className="about-details">
                        {[
                          { label: 'Backend', value: 'FastAPI + Python-SocketIO + MySQL' },
                          { label: 'Frontend', value: 'React 18 + TypeScript + Vite' },
                          { label: 'Temps réel', value: 'Socket.IO (WebSocket)' },
                          { label: 'Algorithme', value: 'Score = α·priorité + β·t_normalisé', mono: true },
                          { label: 'Authentification', value: 'JWT RS256' },
                        ].map((item) => (
                          <div key={item.label} className="about-detail-row">
                            <span className="about-detail-label">{item.label}</span>
                            <span className={`about-detail-value ${item.mono ? 'about-detail-value--mono' : ''}`}>
                              {item.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ============================================================
// DASHBOARD ROUTER
// ============================================================

const DashboardPage: FC = () => {
  const { user } = useAuthStore()

  return user?.role === 'ADMIN' ? <AdminDashboard /> : <AgentDashboard />
}

// ============================================================
// APP ROUTER
// ============================================================

const AppRouter: FC = () => {
  const { isAuthenticated } = useAuthStore()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
        />

        {/* Public ticket tracking route - NO AUTH REQUIRED */}
        <Route path="/track/:ticketUuid" element={<PublicTicketTrackingPage />} />

        <Route path="/display" element={<DisplayPage />} />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />

        <Route
          path="/structures"
          element={
            <RequireAuth adminOnly>
              <StructuresPage />
            </RequireAuth>
          }
        />

        <Route
          path="/agents"
          element={
            <RequireAuth adminOnly>
              <AgentsPage />
            </RequireAuth>
          }
        />

        <Route
          path="/queue"
          element={
            <RequireAuth>
              <QueuePage />
            </RequireAuth>
          }
        />

        <Route
          path="/queue/:structureId"
          element={
            <RequireAuth>
              <QueuePage />
            </RequireAuth>
          }
        />

        <Route
          path="/statistics"
          element={
            <RequireAuth>
              <StatisticsPage />
            </RequireAuth>
          }
        />

        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />

        <Route
          path="*"
          element={
            <div className="not-found-page">
              <div className="not-found-code">404</div>
              <h2>Page introuvable</h2>
              <p>Cette page n'existe pas ou a été déplacée.</p>
              <Link to="/">
                <button className="btn btn-primary">
                  <ArrowRight size={16} />
                  Retour à l'accueil
                </button>
              </Link>
            </div>
          }
        />
      </Routes>

      <ToastContainer />
    </BrowserRouter>
  )
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default AppRouter
