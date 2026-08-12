import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    const { emailHost, emailPort, emailUser, emailPass } = config;
    if (!emailHost || !emailUser || !emailPass) {
        logger.warn('Email not configured: EMAIL_HOST, EMAIL_USER, EMAIL_PASS required');
        return null;
    }
    const isSecure = Number(emailPort) === 465;
    transporter = nodemailer.createTransport({
        host: emailHost,
        port: Number(emailPort) || 587,
        secure: isSecure,
        auth: {
            user: emailUser,
            pass: emailPass
        },
        tls: {
            rejectUnauthorized: false
        }
    });
    return transporter;
}

/**
 * Send OTP email for admin forgot password.
 */
export async function sendAdminResetOtpEmail(to, otp) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Admin OTP email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = 'Your password reset code – Dooriq Admin';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111;">Password reset code</h2>
  <p>Use the code below to reset your admin password. It is valid for 10 minutes.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; background: #f5f5f5; padding: 12px 16px; border-radius: 8px;">${otp}</p>
  <p style="color: #666; font-size: 14px;">If you did not request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">Dooriq Admin</p>
</body>
</html>`;
    const text = `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;

    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `Dooriq <${from}>`,
            to,
            subject,
            text,
            html
        });
        logger.info(`Admin reset OTP email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send admin OTP email to ${to}:`, err.message);
        return false;
    }
}

/**
 * Send restaurant approval email notification.
 */
export async function sendRestaurantApprovedEmail(to, restaurantName, companyName = 'Dooriq') {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Restaurant approval email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = `Congratulations! Your restaurant is approved on ${companyName}`;
    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Restaurant Approved – ${companyName}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:580px;" cellpadding="0" cellspacing="0" border="0">

          <!-- Logo / Brand -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:800;color:#059669;letter-spacing:-0.5px;">${companyName}</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);">

              <!-- Green Header -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:44px 40px 36px;text-align:center;">
                    <div style="width:72px;height:72px;background:rgba(255,255,255,0.18);border-radius:50%;margin:0 auto 16px;line-height:72px;font-size:36px;">&#127881;</div>
                    <h1 style="color:#ffffff;margin:0 0 8px;font-size:30px;font-weight:800;letter-spacing:-0.5px;">Congratulations!</h1>
                    <p style="color:#a7f3d0;margin:0;font-size:16px;font-weight:500;">Your restaurant has been approved</p>
                  </td>
                </tr>
              </table>

              <!-- Body Content -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 40px 8px;">
                    <p style="color:#374151;font-size:16px;margin:0 0 20px;line-height:1.7;">Hi there,</p>
                    <p style="color:#374151;font-size:16px;margin:0 0 28px;line-height:1.7;">
                      We are thrilled to let you know that your restaurant <strong style="color:#059669;">${restaurantName}</strong> has been reviewed and officially <strong>approved</strong> on ${companyName}. You are now ready to start your journey with us!
                    </p>
                  </td>
                </tr>
              </table>

              <!-- What's Next Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 40px 28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfdf5;border-radius:14px;border:1px solid #a7f3d0;">
                      <tr>
                        <td style="padding:24px 28px;">
                          <p style="margin:0 0 14px;font-weight:700;color:#065f46;font-size:15px;">&#9989;&nbsp; What you can do now:</p>
                          <table width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding:5px 0;color:#047857;font-size:14px;">&#8594;&nbsp;&nbsp;Log in to your restaurant dashboard</td>
                            </tr>
                            <tr>
                              <td style="padding:5px 0;color:#047857;font-size:14px;">&#8594;&nbsp;&nbsp;Add your menu items, photos &amp; pricing</td>
                            </tr>
                            <tr>
                              <td style="padding:5px 0;color:#047857;font-size:14px;">&#8594;&nbsp;&nbsp;Set your opening hours &amp; delivery zone</td>
                            </tr>
                            <tr>
                              <td style="padding:5px 0;color:#047857;font-size:14px;">&#8594;&nbsp;&nbsp;Start receiving orders from customers</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>


              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 40px;">
                    <div style="height:1px;background:#e5e7eb;"></div>
                  </td>
                </tr>
              </table>

              <!-- Sign-off -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:24px 40px 36px;">
                    <p style="color:#6b7280;font-size:14px;margin:0 0 16px;line-height:1.7;">
                      If you need any help getting started, our support team is always just a message away. We look forward to growing together!
                    </p>
                    <p style="color:#374151;font-size:15px;margin:0;">
                      Warm regards,<br/>
                      <strong>The ${companyName} Team</strong>
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 8px;">
              <p style="color:#9ca3af;font-size:12px;margin:0 0 4px;">&copy; ${year} ${companyName}. All rights reserved.</p>
              <p style="color:#9ca3af;font-size:12px;margin:0;">You received this email because you registered a restaurant on ${companyName}.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = `Congratulations! Your restaurant "${restaurantName}" has been approved on ${companyName}. Log in to your dashboard: http://localhost:5173/food/restaurant/login`;

    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `${companyName} <${from}>`,
            to,
            subject,
            text,
            html
        });
        logger.info(`Restaurant approval email sent to ${to} for "${restaurantName}"`);
        return true;
    } catch (err) {
        logger.error(`Failed to send restaurant approval email to ${to}:`, err.message);
        return false;
    }
}

/**
 * Send restaurant rejection email notification.
 */
export async function sendRestaurantRejectedEmail(to, restaurantName, reason, companyName = 'Dooriq') {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Restaurant rejection email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = `Update on your restaurant registration – ${companyName}`;
    const reasonText = reason ? reason.trim() : 'Incomplete or insufficient documentation';
    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Registration Update – ${companyName}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:580px;" cellpadding="0" cellspacing="0" border="0">

          <!-- Brand -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:800;color:#dc2626;letter-spacing:-0.5px;">${companyName}</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);">

              <!-- Red Header -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:44px 40px 36px;text-align:center;">
                    <div style="width:72px;height:72px;background:rgba(255,255,255,0.18);border-radius:50%;margin:0 auto 16px;line-height:72px;font-size:36px;">&#128203;</div>
                    <h1 style="color:#ffffff;margin:0 0 8px;font-size:28px;font-weight:800;">Registration Update</h1>
                    <p style="color:#fecaca;margin:0;font-size:15px;">We reviewed your application</p>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 40px 8px;">
                    <p style="color:#374151;font-size:16px;margin:0 0 20px;line-height:1.7;">Hi there,</p>
                    <p style="color:#374151;font-size:16px;margin:0 0 28px;line-height:1.7;">
                      Thank you for submitting your registration for <strong>${restaurantName}</strong> on ${companyName}. After a thorough review of your application, we are unable to approve your registration at this time.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Reason Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 40px 28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef2f2;border-radius:14px;border:1px solid #fecaca;border-left:4px solid #dc2626;">
                      <tr>
                        <td style="padding:22px 24px;">
                          <p style="margin:0 0 8px;font-weight:700;color:#991b1b;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Reason for Rejection</p>
                          <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;">${reasonText}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- What to do next -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 40px 36px;">
                    <p style="color:#374151;font-size:15px;margin:0 0 12px;font-weight:600;">What you can do:</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;color:#6b7280;font-size:14px;line-height:1.8;">
                          &#8226;&nbsp; Address the issue mentioned above<br/>
                          &#8226;&nbsp; Ensure all documents are accurate and complete<br/>
                          &#8226;&nbsp; Re-apply with updated information<br/>
                          &#8226;&nbsp; Contact our support team if you have questions
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:0 40px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
              </table>

              <!-- Sign-off -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:24px 40px 36px;">
                    <p style="color:#6b7280;font-size:14px;margin:0 0 16px;line-height:1.7;">
                      We appreciate your interest in joining ${companyName}. We hope to welcome you onboard soon.
                    </p>
                    <p style="color:#374151;font-size:15px;margin:0;">
                      Regards,<br/>
                      <strong>The ${companyName} Team</strong>
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 8px;">
              <p style="color:#9ca3af;font-size:12px;margin:0 0 4px;">&copy; ${year} ${companyName}. All rights reserved.</p>
              <p style="color:#9ca3af;font-size:12px;margin:0;">You received this because you registered a restaurant on ${companyName}.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = `Your restaurant "${restaurantName}" registration on ${companyName} was not approved. Reason: ${reasonText}. Please contact support if you have questions.`;

    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `${companyName} <${from}>`,
            to,
            subject,
            text,
            html
        });
        logger.info(`Restaurant rejection email sent to ${to} for "${restaurantName}"`);
        return true;
    } catch (err) {
        logger.error(`Failed to send restaurant rejection email to ${to}:`, err.message);
        return false;
    }
}
    

/**
 * Send delivery partner approval email notification.
 */
export async function sendDeliveryPartnerApprovedEmail(to, partnerName, companyName = 'Dooriq') {
    const trans = getTransporter();
    if (!trans) { logger.warn('Delivery partner approval email skipped: SMTP not configured'); return false; }
    const from = config.emailFrom || config.emailUser;
    const subject = `Welcome Aboard! Your delivery partner application is approved - ${companyName}`;
    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'/></head><body style='margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;'><table width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#f0f4f8;padding:48px 16px;'><tr><td align='center'><table width='100%' style='max-width:580px;' cellpadding='0' cellspacing='0' border='0'><tr><td align='center' style='padding-bottom:24px;'><span style='font-size:22px;font-weight:800;color:#059669;'>${companyName}</span></td></tr><tr><td style='background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);'><table width='100%' cellpadding='0' cellspacing='0' border='0'><tr><td style='background:linear-gradient(135deg,#059669,#047857);padding:44px 40px 36px;text-align:center;'><div style='font-size:48px;margin-bottom:12px;'>&#x1F6F5;</div><h1 style='color:#fff;margin:0 0 8px;font-size:28px;font-weight:800;'>Welcome Aboard!</h1><p style='color:#a7f3d0;margin:0;font-size:15px;'>You are officially a ${companyName} delivery partner</p></td></tr><tr><td style='padding:36px 40px;'><p style='color:#374151;font-size:16px;margin:0 0 16px;'>Hi <strong>${partnerName}</strong>,</p><p style='color:#374151;font-size:16px;margin:0 0 24px;line-height:1.7;'>Your application to join <strong style='color:#059669;'>${companyName}</strong> as a delivery partner has been <strong>approved</strong>. You can now go online and start earning!</p><table width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#ecfdf5;border-radius:12px;border:1px solid #a7f3d0;margin-bottom:28px;'><tr><td style='padding:20px 24px;'><p style='margin:0 0 10px;font-weight:700;color:#065f46;'>&#9989; You can now:</p><p style='margin:0;color:#047857;font-size:14px;line-height:1.8;'>&#8594; Log in and go online to accept deliveries<br/>&#8594; Track your earnings and order history<br/>&#8594; Refer friends and earn referral bonuses</p></td></tr></table><div style='text-align:center;margin-bottom:28px;'><a href='http://localhost:5173/food/delivery/login' style='display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:10px;'>Open Delivery App &rarr;</a></div><p style='color:#374151;font-size:15px;margin:0;'>Warm regards,<br/><strong>The ${companyName} Team</strong></p></td></tr></table></td></tr><tr><td align='center' style='padding:24px 0;'><p style='color:#9ca3af;font-size:12px;margin:0;'>&copy; ${year} ${companyName}. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`;
    const text = `Your delivery partner application has been approved on ${companyName}. Log in: http://localhost:5173/food/delivery/login`;
    try {
        await trans.sendMail({ from: typeof from === 'string' && from.includes('<') ? from : `\${companyName} <\${from}>`, to, subject, text, html });
        logger.info(`Delivery partner approval email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send delivery partner approval email to ${to}:`, err.message);
        return false;
    }
}

/**
 * Send delivery partner rejection email notification.
 */
export async function sendDeliveryPartnerRejectedEmail(to, partnerName, reason, companyName = 'Dooriq') {
    const trans = getTransporter();
    if (!trans) { logger.warn('Delivery partner rejection email skipped: SMTP not configured'); return false; }
    const from = config.emailFrom || config.emailUser;
    const subject = `Update on your delivery partner application - ${companyName}`;
    const reasonText = reason ? reason.trim() : 'Incomplete or insufficient documentation';
    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'/></head><body style='margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;'><table width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#f0f4f8;padding:48px 16px;'><tr><td align='center'><table width='100%' style='max-width:580px;' cellpadding='0' cellspacing='0' border='0'><tr><td align='center' style='padding-bottom:24px;'><span style='font-size:22px;font-weight:800;color:#dc2626;'>${companyName}</span></td></tr><tr><td style='background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);'><table width='100%' cellpadding='0' cellspacing='0' border='0'><tr><td style='background:linear-gradient(135deg,#dc2626,#b91c1c);padding:44px 40px 36px;text-align:center;'><div style='font-size:48px;margin-bottom:12px;'>&#128203;</div><h1 style='color:#fff;margin:0 0 8px;font-size:28px;font-weight:800;'>Application Update</h1><p style='color:#fecaca;margin:0;font-size:15px;'>We reviewed your delivery partner application</p></td></tr><tr><td style='padding:36px 40px;'><p style='color:#374151;font-size:16px;margin:0 0 16px;'>Hi <strong>${partnerName}</strong>,</p><p style='color:#374151;font-size:16px;margin:0 0 24px;line-height:1.7;'>Thank you for applying to join <strong>${companyName}</strong> as a delivery partner. After reviewing your application, we are unable to approve it at this time.</p><table width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#fef2f2;border-radius:12px;border-left:4px solid #dc2626;margin-bottom:24px;'><tr><td style='padding:20px 24px;'><p style='margin:0 0 8px;font-weight:700;color:#991b1b;font-size:13px;text-transform:uppercase;'>Reason for Rejection</p><p style='margin:0;color:#374151;font-size:15px;line-height:1.7;'>${reasonText}</p></td></tr></table><p style='color:#374151;font-size:15px;margin:0;'>Regards,<br/><strong>The ${companyName} Team</strong></p></td></tr></table></td></tr><tr><td align='center' style='padding:24px 0;'><p style='color:#9ca3af;font-size:12px;margin:0;'>&copy; ${year} ${companyName}. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`;
    const text = `Your delivery partner application on ${companyName} was not approved. Reason: ${reasonText}. Re-apply after addressing the issue or contact support.`;
    try {
        await trans.sendMail({ from: typeof from === 'string' && from.includes('<') ? from : `\${companyName} <\${from}>`, to, subject, text, html });
        logger.info(`Delivery partner rejection email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send delivery partner rejection email to ${to}:`, err.message);
        return false;
    }
}
