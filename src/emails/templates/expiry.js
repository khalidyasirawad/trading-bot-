/**
 * Expiry warning email — sent 3 days before access expires.
 * Kicked members also receive a final expiry notice.
 */

export function expiryWarningSubject() {
  return 'Your VIP access expires in 3 days';
}

export function expiryFinalSubject() {
  return 'Your VIP access has ended — renew to stay in';
}

/**
 * 3-day warning email.
 * @param {{ firstName?: string, expiresAt: Date, renewLink: string }} params
 */
export function expiryWarningHtml({ firstName = 'Trader', expiresAt, renewLink }) {
  const expiryStr = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>VIP Access Expiring</title>
  <style>
    body { margin: 0; padding: 0; background-color: #07090d; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 560px; margin: 40px auto; background: #0d1117; border: 1px solid #1e2330; border-radius: 8px; overflow: hidden; }
    .header { background: #0d1117; border-bottom: 2px solid #c0392b; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 20px; color: #e74c3c; }
    .body { padding: 36px 40px; }
    .body p { line-height: 1.7; font-size: 15px; color: #c8c8c8; }
    .cta-btn { display: block; margin: 28px auto; width: fit-content; background: #f5c842; color: #07090d; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 6px; }
    .countdown { text-align: center; font-size: 28px; font-weight: 700; color: #f5c842; margin: 20px 0; }
    .footer { border-top: 1px solid #1e2330; padding: 20px 40px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ VIP Access Expiring Soon</h1>
    </div>
    <div class="body">
      <p>Hi ${firstName},</p>
      <p>Your VIP signal access expires on <strong>${expiryStr}</strong>.</p>
      <div class="countdown">3 days left</div>
      <p>After that, you'll lose access to:</p>
      <ul style="padding-left:20px; color:#c8c8c8; font-size:15px; line-height:2;">
        <li>Daily entry, SL, and TP signals</li>
        <li>TP confirmation alerts</li>
        <li>Full trade reasoning and R:R breakdowns</li>
      </ul>
      <p>Renew in 60 seconds to keep your access uninterrupted.</p>
      <a href="${renewLink}" class="cta-btn">→ Renew VIP Access</a>
    </div>
    <div class="footer">Access expires ${expiryStr}. Questions? Reply to this email.</div>
  </div>
</body>
</html>`;
}

/**
 * Final expiry email (sent after kick).
 */
export function expiryFinalHtml({ firstName = 'Trader', renewLink }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>VIP Access Ended</title>
  <style>
    body { margin: 0; padding: 0; background-color: #07090d; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 560px; margin: 40px auto; background: #0d1117; border: 1px solid #1e2330; border-radius: 8px; overflow: hidden; }
    .header { background: #0d1117; border-bottom: 2px solid #333; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 20px; color: #aaa; }
    .body { padding: 36px 40px; }
    .body p { line-height: 1.7; font-size: 15px; color: #c8c8c8; }
    .cta-btn { display: block; margin: 28px auto; width: fit-content; background: #f5c842; color: #07090d; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 6px; }
    .footer { border-top: 1px solid #1e2330; padding: 20px 40px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔒 Your VIP Access Has Ended</h1>
    </div>
    <div class="body">
      <p>Hi ${firstName},</p>
      <p>Your VIP subscription has expired and you've been removed from the private channel.</p>
      <p>The next signal posts in less than 24 hours. VIP members will have entry, SL, and all 3 TPs defined before the market moves.</p>
      <p>Rejoin in under a minute:</p>
      <a href="${renewLink}" class="cta-btn">→ Renew VIP — Rejoin Now</a>
      <p style="color:#666; font-size:13px;">Once you renew, you'll receive a new invite link by email within minutes.</p>
    </div>
    <div class="footer">You can renew at any time. Questions? Reply to this email.</div>
  </div>
</body>
</html>`;
}
