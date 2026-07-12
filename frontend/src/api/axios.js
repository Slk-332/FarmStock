import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://farmstock-68dt.onrender.com/api'
const baseURL = API_URL.endsWith('/api') ? API_URL : `${API_URL.replace(/\/$/, '')}/api`

const api = axios.create({
  baseURL,
})

// แนบ token ทุก request อัตโนมัติ
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ถ้า token หมดอายุ redirect ไป login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
