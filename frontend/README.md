# ResQNet

Offline-first emergency reporting PWA built with React and Vite. Reports are stored in IndexedDB and remain available on this device offline. GPS requires browser permission and a secure context (HTTPS or localhost); map tiles require an internet connection.

## Run

```sh
npm install
npm run dev
npm run build
npm run preview
```

Load the app once while online to cache the application shell for offline use. Installability and GPS require a supported browser and secure hosting.

## Optional report API

Without an API URL, reports remain pending on this device and are not uploaded. To enable syncing, set `VITE_RESQNET_API_URL` in a local Vite environment file such as `.env.local` to the API base URL. The app sends each pending report as JSON with `POST {base-url}/reports` and an `Idempotency-Key` header containing the report ID. The API must support idempotent handling of that key and allow the app origin through CORS. Only a successful 2xx response marks the report as synced; failed requests remain pending for a later online attempt.
