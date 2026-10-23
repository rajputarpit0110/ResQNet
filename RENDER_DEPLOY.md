# 🚀 ResQNet — Render Deployment Guide

ResQNet is configured for **1-click / zero-config deployment** on [Render](https://render.com) using a single Unified Web Service on the Free Tier.

The backend Express server automatically:
1. Serves the **API** endpoints (`/api/health`, `/api/reports`, `/api/auth/login`, `/p2p/*`).
2. Serves the **Production PWA Frontend** (`dist/`) directly on the same origin.
3. Automatically avoids all CORS and cross-origin PWA Service Worker caching issues.

---

## ⚡ Option 1: Automatic Blueprint (Recommended - 1 Click)

1. Push your latest code to GitHub.
2. Go to your [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** → Select **Blueprint**.
4. Connect your **ResQNet** GitHub repository: `rajputarpit0110/ResQNet`.
5. Render will automatically detect the [`render.yaml`](./render.yaml) file in the repository root.
6. Click **Apply**.
7. Render will build both frontend and backend and launch your live URL (e.g. `https://resqnet.onrender.com`).

---

## 🛠️ Option 2: Manual Web Service Setup

If you prefer setting up the Web Service manually:

1. In the Render Dashboard, click **New +** → Select **Web Service**.
2. Connect your GitHub repository (`ResQNet`).
3. Fill in the following settings:

| Setting | Value |
|---|---|
| **Name** | `resqnet` (or any custom name) |
| **Language / Runtime** | `Node` |
| **Branch** | `main` |
| **Build Command** | `npm run render-build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

4. Under **Advanced Settings**:
   - **Health Check Path**: `/api/health`
   - **Environment Variables**:
     - `NODE_ENV` = `production`

5. Click **Create Web Service**.

---

## 🧪 Post-Deployment Verification Checklist

Once the deployment completes and Render shows `Live`:

- [ ] **Health Endpoint**: Visit `https://<your-service>.onrender.com/api/health` — should return `{"status":"ok", ...}`.
- [ ] **Frontend PWA**: Visit `https://<your-service>.onrender.com/` — the full ResQNet app should load with green theme.
- [ ] **Offline Storage & SOS**: Tap SOS to verify local IndexedDB record creation.
- [ ] **Emergency Report**: Submit a test report and confirm the toast confirmation.
- [ ] **Rescuer Dashboard**: Go to the **Rescuer** tab and log in using PIN `9999` to see reported incidents.
