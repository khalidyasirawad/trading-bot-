/**
 * Weekly promo/performance recap email template.
 */

export function promoEmailSubject(winRate) {
  return `This week's win rate: ${winRate}% — see the calls`;
}

/**
 * @param {{ firstName?: string, winRate: number, wins: number, losses: number, bestTrade?: string, renewLink: string }} params
 */
export function promoEmailHtml({ firstName = 'Trader', winRate, wins, losses, bestTrade = '', renewLink }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Weekly Performance</title>
  <style>
    body { margin: 0; padding: 0; background-color: #07090d; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 560px; margin: 40px auto; background: #0d1117; border: 1px solid #1e2330; border-radius: 8px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #0d1117 0%, #131820 100%); border-bottom: 2px solid #f5c842; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 22px; color: #f5c842; }
    .header p { margin: 8px 0 0; color: #888; font-size: 13px; }
    .stats { display: flex; gap: 16px; padding: 24px 40px; background: #0a0c11; }
    .stat { flex: 1; text-align: center; }
    .stat .value { font-size: 32px; font-weight: 700; color: #f5c842; }
    .stat .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .body { padding: 28px 40px; }
    .body p { line-height: 1.7; font-size: 15px; color: #c8c8c8; }
    .best-trade { background: #0a0c11; border-left: 3px solid #f5c842; padding: 12px 16px; margin: 16px 0; font-size: 14px; color: #c8c8c8; border-radius: 0 4px 4px 0; }
    .cta-btn { display: block; margin: 28px auto; width: fit-content; background: #f5c842; color: #07090d; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 6px; }
    .footer { border-top: 1px solid #1e2330; padding: 20px 40px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Signal Report</h1>
      <p>Gold Signal Bot · VIP Performance Recap</p>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="value">${winRate}%</div>
        <div class="label">Win Rate</div>
      </div>
      <div class="stat">
        <div class="value">${wins}W / ${losses}L</div>
        <div class="label">This Week</div>
      </div>
    </div>
    <div class="body">
      <p>Hi ${firstName},</p>
      <p>Here's how our VIP signals performed this week:</p>
      ${bestTrade ? `<div class="best-trade">🏆 Best trade: ${bestTrade}</div>` : ''}
      <p>All entries, stop losses, and take profits were posted in the VIP channel <strong>before the move</strong>.</p>
      ${!firstName || firstName === 'Trader' ? `<p>Not a VIP member yet? You can access next week's signals for less than a coffee per day.</p>` : ''}
      <a href="${renewLink}" class="cta-btn">→ Join / Renew VIP Access</a>
    </div>
    <div class="footer">You're receiving this because you opted into our trading updates. Unsubscribe anytime by replying "stop".</div>
  </div>
</body>
</html>`;
}
