# SerbisyoNow Deployment

This project is ready to run as one hosted Node.js app: Express serves both the API and the frontend pages.

## Recommended Free Setup

Use Render for the Node.js service and a hosted PostgreSQL database.

## Environment Variables

Set these in the hosting dashboard, not inside the repository:

```txt
PORT=10000
DATABASE_URL=your-hosted-postgres-url
DATABASE_SSL=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-strong-password
FRONTEND_BASE_URL=https://your-serbisyonow-domain.onrender.com
API_PUBLIC_BASE_URL=https://your-serbisyonow-domain.onrender.com
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-serbisyonow-domain.onrender.com/api/auth/google/callback
PASSWORD_RESET_TTL_MINUTES=60
ALLOW_RESET_LINK_IN_RESPONSE=false
GMAIL_API_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GMAIL_API_CLIENT_SECRET=your-google-client-secret
GMAIL_API_REFRESH_TOKEN=your-gmail-api-refresh-token
GMAIL_API_FROM=SerbisyoNow <your-gmail@gmail.com>
```

## Google OAuth

In Google Cloud Console, add this Authorized redirect URI:

```txt
https://your-serbisyonow-domain.onrender.com/api/auth/google/callback
```

If you keep testing locally, also keep this local redirect URI:

```txt
http://localhost:3000/api/auth/google/callback
```

## Forgot Password Email

Render Free blocks SMTP ports, so Gmail SMTP will not work reliably on the live site. Use Gmail API instead.

1. In Google Cloud Console, enable the Gmail API for the same project.
2. Create a Gmail API refresh token with this scope:

```txt
https://www.googleapis.com/auth/gmail.send
```

3. Add these Render environment variables:

```txt
GMAIL_API_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GMAIL_API_CLIENT_SECRET=your-google-client-secret
GMAIL_API_REFRESH_TOKEN=your-gmail-api-refresh-token
GMAIL_API_FROM=SerbisyoNow <your-gmail@gmail.com>
```

`GMAIL_API_FROM` should use the Gmail account that created the refresh token.

## Deploy Commands

Build command:

```txt
npm install && npm run init-db
```

Start command:

```txt
npm start
```

## Important Notes

- Do not upload `.env`; it is already ignored by Git.
- Hosted PostgreSQL usually needs `DATABASE_SSL=true`.
- Uploaded files in `uploads/` may not persist on free hosting after redeploys. For a production version, move uploads to object storage later.
