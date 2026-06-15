/**
 * Welcome email sent immediately after a subscriber completes checkout.
 * Includes the private invite link to the VIP Telegram channel.
 */

export function welcomeEmailSubject() {
  return "You're in. Here's your VIP access link.";
}

/**
 * @param {{ firstName?: string, inviteLink: string, expiresAt: Date }} params
 */
export function welcomeEmailHtml({ firstName = 'Trader', inviteLink, expiresAt }) {
  const expiryStr = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VIP Access Confirmed</title>
  <style>
    body { margin: 0; padding: 0; background-color: #07090d; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 560px; margin: 40px auto; background: #0d1117; border: 1px solid #1e2330; border-radius: 8px; overflow: hidden; }
    .header { background: #0d1117; border-bottom: 2px solid #f5c842; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 22px; color: #f5c842; letter-spacing: 1px; text-transform: uppercase; }
    .header p { margin: 8px 0 0; font-size: 13px; color: #888; }
    .body { padding: 36px 40px; }
    .body p { line-height: 1.7; font-size: 15px; color: #c8c8c8; }
    .cta-btn { display: block; margin: 28px auto; width: fit-content; background: #f5c842; color: #07090d; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 6px; letter-spacing: 0.5px; }
    .info-box { background: #0a0c11; border: 1px solid #1e2330; border-radius: 6px; padding: 16px 20px; margin: 20px 0; font-size: 13px; color: #888; }
    .info-box span { color: #f5c842; font-weight: 600; }
    .footer { border-top: 1px solid #1e2330; padding: 20px 40px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ VIP Access Confirmed</h1>
      <p>Gold Signal Bot · Premium Signals</p>
    </div>
    <div class="body">
      <p>Welcome, <strong>${firstName}</strong>.</p>
      <p>Your VIP subscription is active. Click the button below to join the private Telegram channel — this link is <strong>single-use</strong> and expires in 10 minutes.</p>

      <a href="${inviteLink}" class="cta-btn">→ Join VIP Channel</a>

      <div class="info-box">
        <div>📅 Access expires: <span>${expiryStr}</span></div>
        <div style="margin-top:8px;">⚠️ This link is for you only. Do not share it.</div>
      </div>

      <p>What to expect in VIP:</p>
      <ul style="padding-left:20px; color:#c8c8c8; font-size:15px; line-height:2;">
        <li>Daily XAU/USD & BTC/USD signals with entry, SL, and TP1/2/3</li>
        <li>Risk:Reward ratios and trade reasoning on every call</li>
        <li>Real-time TP hit confirmations</li>
      </ul>

      <p style="color:#888; font-size:13px;">Signals post daily at 10:00 UTC. Make sure your Telegram notifications are on.</p>
    </div>
    <div class="footer">
      You received this because you purchased VIP access. Questions? Reply to this email.<br />
      Your access expires ${expiryStr}.
    </div>
  </div>
</body>
</html>`;
}
