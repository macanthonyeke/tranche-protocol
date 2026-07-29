// Thin wrapper around Resend's send API, in the same spirit as pinata.js:
// the caller decides what to say, this module only talks to the provider.
//
// Used for one thing — delivering Tranche's own email-verification code
// before a freelancer's email is bound to a payout address. That code is a
// proof we hold independently of Circle, so it deliberately does NOT travel
// over Circle's SMTP.

const RESEND_SEND_URL = 'https://api.resend.com/emails'

export class ResendError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 */
export async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new ResendError('Email verification is not configured on the server.', 503)

  const from = process.env.RESEND_FROM
  if (!from) throw new ResendError('Email verification is not configured on the server.', 503)

  let res
  try {
    res = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) })
    })
  } catch (err) {
    throw new ResendError(`Could not reach the email service: ${err.message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Logged, not returned: Resend echoes the recipient address in some
    // errors, and this endpoint is reachable by anyone.
    console.error(`Resend send failed (${res.status}):`, detail.slice(0, 300))
    throw new ResendError('Could not send the verification email. Please try again.')
  }
}

/**
 * Copy for the verification mail. Kept here so the wording, the code, and the
 * expiry stated to the user can never drift apart.
 * @param {string} code
 * @param {number} ttlMinutes
 */
export function verificationMessage(code, ttlMinutes) {
  return {
    subject: `${code} is your Tranche verification code`,
    text: [
      `Your Tranche verification code is ${code}.`,
      '',
      `It expires in ${ttlMinutes} minutes.`,
      '',
      'This confirms your email so people can pay you at it. If you did not',
      'sign up for Tranche, ignore this email — nothing has been linked to',
      'your address, and no one can pay to it without this code.'
    ].join('\n')
  }
}
