/**
 * Renewal reminder email — sent when the next signal posts soon.
 */

export function renewalEmailSubject() {
  return 'Renew now — next signal posts in 18 hours';
}

/**
 * @param {{ firstName?: string, renewLink: string }} params
 */
export function renewalEmailHtml({ firstName = 'Trader', renewLink }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Renew VIP Access</title>
  <style>
    body { margin: 0; padding: 0; background-color: #07090d; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 560px; margin: 40px auto; background: #0d1117; border: 1px solid #1e2330; border-radius: 8px; overflow: hidden; }
    .header { background: #0d1117; border-bottom: 2px solid #f5c842; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 20px; color: #f5c842; }
    .body { padding: 36px 40px; }
    .body p { line-height: 1.7; font-size: 15px; color: #c8c8c8; }
    .countdown-bar { background: #0a0c11; border: 1px solid #f5c842; border-radius: 6px; padding: 16px 20px; text-align: center; margin: 20px 0; }
    .countdown-bar .time { font-size: 26px; font-weight: 700; color: #f5c842; }
    .countdown-bar .label { font-size: 12px; color: #888; margin-top: 4px; }
    .cta-btn { display: block; margin: 28px auto; width: fit-content; background: #f5c842; color: #07090d; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 6px; }
    .footer { border-top: 1px solid #1e2330; padding: 20px 40px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⏰ Next Signal Posts Soon</h1>
    </div>
    <div class="body">
      <p>Hi ${firstName},</p>
      <p>Your VIP access is inactive, but the next XAU/USD signal drops in:</p>

      <div class="countdown-bar">
        <div class="time">~18 hours</div>
        <div class="label">until next VIP signal</div>
      </div>

      <p>VIP members will receive the exact entry price, stop loss, and three take-profit targets before the market moves.</p>
      <p>Renew now and you won't miss it:</p>

      <a href="${renewLink}" class="cta-btn">→ Renew VIP Access Now</a>

      <p style="color:#666; font-size:13px;">Renewal takes under 60 seconds. You'll receive a new channel invite link by email immediately.</p>
    </div>
    <div class="footer">You received this because your VIP access has lapsed. Unsubscribe anytime by replying "stop".</div>
  </div>
</body>
</html>`;
}
