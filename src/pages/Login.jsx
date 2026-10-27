import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

const CLIENT_ID = '883351541905-ual5as4i001ovkmuf1opc2blecjvl135.apps.googleusercontent.com'
const SCOPES    = 'openid profile email https://www.googleapis.com/auth/drive.file'

export default function Login() {
  const setAuth    = useStore(s => s.setAuth)
  const authLoading = useStore(s => s.authLoading)
  const btnRef     = useRef(null)
  const [authError, setAuthError] = useState('')

  const initGIS = useCallback(() => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope:     SCOPES,
      callback:  async (tokenResponse) => {
        if (tokenResponse.error) {
          setAuthError(tokenResponse.error_description ?? tokenResponse.error)
          return
        }
        try {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          })
          const userInfo = await userRes.json()
          if (!userRes.ok) {
            setAuthError(`Google profile lookup failed (${userRes.status}): ${userInfo.error?.message ?? 'check the requested OAuth scopes'}`)
            return
          }
          await setAuth({
            accessToken: tokenResponse.access_token,
            name:    userInfo.name,
            email:   userInfo.email,
            picture: userInfo.picture,
          })
        } catch (e) {
          setAuthError(`Google sign-in failed: ${e.message}`)
        }
      },
      error_callback: (error) => setAuthError(error?.message ?? error?.type ?? 'Google sign-in could not be opened.'),
    })

    if (btnRef.current) {
      btnRef.current.onclick = () => {
        setAuthError('')
        tokenClient.requestAccessToken()
      }
    }
  }, [setAuth])

  useEffect(() => {
    // Load Google Identity Services script
    const script = document.createElement('script')
    script.src   = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = initGIS
    document.head.appendChild(script)
    return () => document.head.removeChild(script)
  }, [initGIS])

  return (
    <div style={{
      minHeight: '100vh', background: '#0f0f17',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#16161f', border: '1px solid #2a2a3e',
        borderRadius: 16, padding: 40, width: '100%', maxWidth: 400,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 22, marginBottom: 6 }}>
          The Operators PM Board
        </div>
        <div style={{ color: '#555', fontSize: 13, marginBottom: 32 }}>
          Project data is stored in your Google Drive
        </div>

        <button ref={btnRef} disabled={authLoading} style={{
          display: 'inline-flex', alignItems: 'center', gap: 12,
          background: authLoading ? '#333' : '#fff',
          border: 'none', borderRadius: 8, padding: '12px 24px',
          color: '#333', fontWeight: 600, fontSize: 15, cursor: authLoading ? 'not-allowed' : 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {!authLoading && (
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
          )}
          {authLoading ? 'Connecting…' : 'Sign in with Google'}
        </button>

        {authError && <div role="alert" style={{ color: '#F44336', fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>{authError}</div>}

        <div style={{ color: '#333', fontSize: 11, marginTop: 20 }}>
          Only accesses files created by this app
        </div>
      </div>
    </div>
  )
}
