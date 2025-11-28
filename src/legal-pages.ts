// Legal Page Templates - Privacy, Terms, Refunds, Cookies
// Last Updated: November 28, 2025

const LEGAL_FOOTER_HTML = `
  <footer class="bg-gray-900 text-white py-12 mt-20">
    <div class="max-w-7xl mx-auto px-4 grid md:grid-cols-4 gap-8">
      <div>
        <h4 class="font-bold mb-4">Product</h4>
        <ul class="space-y-2 text-gray-300 text-sm">
          <li><a href="/pricing" class="hover:text-white">Pricing</a></li>
          <li><a href="/faq" class="hover:text-white">FAQ</a></li>
          <li><a href="/about" class="hover:text-white">About</a></li>
          <li><a href="/blog" class="hover:text-white">Blog</a></li>
        </ul>
      </div>
      <div>
        <h4 class="font-bold mb-4">Legal</h4>
        <ul class="space-y-2 text-gray-300 text-sm">
          <li><a href="/privacy" class="hover:text-white">Privacy Policy</a></li>
          <li><a href="/terms" class="hover:text-white">Terms of Service</a></li>
          <li><a href="/refunds" class="hover:text-white">Refund Policy</a></li>
          <li><a href="/cookies" class="hover:text-white">Cookie Policy</a></li>
        </ul>
      </div>
      <div>
        <h4 class="font-bold mb-4">Support</h4>
        <ul class="space-y-2 text-gray-300 text-sm">
          <li><a href="/contact" class="hover:text-white">Contact Us</a></li>
          <li><a href="/faq" class="hover:text-white">Help Center</a></li>
          <li><a href="mailto:support@shopshot.co.uk" class="hover:text-white">Email Support</a></li>
        </ul>
      </div>
      <div>
        <h4 class="font-bold mb-4">ShopShot</h4>
        <p class="text-gray-400 text-sm leading-relaxed">
          Professional AI product photography for online sellers.
        </p>
      </div>
    </div>
    <div class="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
      <p>&copy; 2025 ShopShot Ltd. All rights reserved.</p>
      <p class="mt-1">Registered in England | Burwash, East Sussex</p>
    </div>
  </footer>
`

const LEGAL_HEADER_HTML = `
  <header class="bg-white border-b border-gray-200">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 text-xl font-bold text-gray-900">
        <span class="text-2xl">📸</span> ShopShot
      </a>
      <nav class="flex items-center gap-4">
        <a href="/faq" class="text-gray-600 hover:text-gray-900 text-sm">FAQ</a>
        <a href="/contact" class="text-gray-600 hover:text-gray-900 text-sm">Contact</a>
        <a href="/app" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Open App</a>
      </nav>
    </div>
  </header>
`

const LEGAL_STYLES = `
  <style>
    * { font-family: 'Inter', sans-serif; }
    .legal-content h2 { margin-top: 2rem; margin-bottom: 1rem; font-size: 1.25rem; font-weight: 700; color: #1F2937; }
    .legal-content h3 { margin-top: 1.5rem; margin-bottom: 0.75rem; font-size: 1rem; font-weight: 600; color: #374151; }
    .legal-content p { margin-bottom: 1rem; line-height: 1.7; }
    .legal-content ul, .legal-content ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    .legal-content ul { list-style-type: disc; }
    .legal-content ol { list-style-type: decimal; }
    .legal-content li { margin-bottom: 0.5rem; line-height: 1.6; }
    .legal-content a { color: #2563EB; text-decoration: underline; }
    .legal-content a:hover { color: #1D4ED8; }
    .info-box { background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .warning-box { background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .danger-box { background: #FEE2E2; border: 1px solid #FECACA; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .success-box { background: #D1FAE5; border: 1px solid #6EE7B7; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #E5E7EB; }
    th { background: #F9FAFB; font-weight: 600; color: #374151; }
    tr:hover { background: #F9FAFB; }
  </style>
`

export function getPrivacyPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/privacy">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${LEGAL_STYLES}
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>ShopShot Ltd ("we," "us," or "our") operates www.shopshot.co.uk (the "Service"). This Privacy Policy explains how we collect, use, and protect your personal information.</p>
        
        <div class="info-box">
          <p class="font-semibold text-gray-900 mb-2">Data Controller:</p>
          <p class="mb-1">ShopShot Ltd</p>
          <p class="mb-1">Burwash, East Sussex, England</p>
          <p>Contact: <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
        </div>
        
        <h2>1. Information We Collect</h2>
        
        <h3>Account Information:</h3>
        <ul>
          <li>Email address (for login and communications)</li>
          <li>Encrypted password (hashed, never stored in plain text)</li>
          <li>Name (optional)</li>
        </ul>
        
        <h3>Product Images:</h3>
        <ul>
          <li>Photos you upload for AI generation</li>
          <li>Generated image variations</li>
          <li>Associated metadata (upload date, session details)</li>
        </ul>
        
        <h3>Payment Information:</h3>
        <ul>
          <li>Processed by Stripe (we never store full card details)</li>
          <li>Billing address and transaction history</li>
          <li>Subscription status</li>
        </ul>
        
        <h3>Usage Data:</h3>
        <ul>
          <li>IP address and browser type</li>
          <li>Session cookies for authentication</li>
          <li>Credit usage and generation history</li>
        </ul>
        
        <h2>2. How We Use Your Information</h2>
        
        <h3>Legal Basis (GDPR Article 6):</h3>
        <table>
          <thead>
            <tr>
              <th>Data Type</th>
              <th>Purpose</th>
              <th>Legal Basis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account details</td>
              <td>Service delivery</td>
              <td>Contract performance</td>
            </tr>
            <tr>
              <td>Images</td>
              <td>AI generation</td>
              <td>Contract performance</td>
            </tr>
            <tr>
              <td>Payment data</td>
              <td>Billing and tax compliance</td>
              <td>Contract performance + Legal obligation</td>
            </tr>
            <tr>
              <td>Marketing emails</td>
              <td>Promotional communications</td>
              <td>Consent (opt-in)</td>
            </tr>
            <tr>
              <td>Usage logs</td>
              <td>Security and fraud prevention</td>
              <td>Legitimate interest</td>
            </tr>
          </tbody>
        </table>
        
        <p>We use your information to:</p>
        <ul>
          <li>Generate AI product images</li>
          <li>Process payments and manage subscriptions</li>
          <li>Send service updates and (with consent) marketing emails</li>
          <li>Prevent fraud and ensure platform security</li>
          <li>Comply with legal obligations (tax records, dispute resolution)</li>
        </ul>
        
        <h2>3. Third-Party Service Providers</h2>
        <p>We share your data with trusted partners who help us operate the Service:</p>
        
        <h3>Payment Processing:</h3>
        <ul>
          <li><strong>Stripe Inc.</strong> (payment gateway)</li>
          <li>Processes billing information securely</li>
          <li>Subject to <a href="https://stripe.com/privacy" target="_blank">Stripe's privacy policy</a></li>
        </ul>
        
        <h3>AI Image Generation:</h3>
        <ul>
          <li>Third-party AI technology providers</li>
          <li>Processes uploaded images to generate variations</li>
          <li>Data transmitted securely via encrypted connections</li>
        </ul>
        
        <h3>Email Communications:</h3>
        <ul>
          <li><strong>Resend</strong> (transactional and marketing emails)</li>
          <li>Stores email addresses for delivery</li>
        </ul>
        
        <h3>Infrastructure:</h3>
        <ul>
          <li><strong>Cloudflare</strong> (hosting, security, database)</li>
          <li>Provides secure data storage and content delivery</li>
        </ul>
        
        <div class="warning-box">
          <p class="font-semibold text-gray-900 mb-2">International Data Transfers:</p>
          <p>Some service providers operate servers outside the UK/EU (including the United States). We ensure appropriate safeguards through Standard Contractual Clauses and privacy shield frameworks.</p>
        </div>
        
        <h2>4. Data Retention</h2>
        <table>
          <thead>
            <tr>
              <th>Data Type</th>
              <th>Retention Period</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Product images</td>
              <td>90 days from generation</td>
            </tr>
            <tr>
              <td>Account information</td>
              <td>30 days after account deletion</td>
            </tr>
            <tr>
              <td>Payment records</td>
              <td>7 years (UK tax law requirement)</td>
            </tr>
            <tr>
              <td>Marketing consent</td>
              <td>Until you unsubscribe</td>
            </tr>
            <tr>
              <td>Session logs</td>
              <td>90 days</td>
            </tr>
          </tbody>
        </table>
        <p>You can request immediate deletion of your images at any time via your account settings.</p>
        
        <h2>5. Your Rights (GDPR)</h2>
        <p>You have the right to:</p>
        <ul>
          <li>✅ <strong>Access</strong> - Request a copy of your personal data</li>
          <li>✅ <strong>Rectification</strong> - Correct inaccurate information</li>
          <li>✅ <strong>Erasure</strong> - Delete your account and data (subject to legal retention requirements)</li>
          <li>✅ <strong>Portability</strong> - Export your data in machine-readable format</li>
          <li>✅ <strong>Object</strong> - Opt out of marketing communications</li>
          <li>✅ <strong>Withdraw Consent</strong> - Unsubscribe from marketing emails anytime</li>
        </ul>
        
        <p>To exercise these rights, contact: <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
        
        <div class="info-box">
          <p class="font-semibold text-gray-900 mb-2">Right to Complain:</p>
          <p>If you believe we've mishandled your data, you can lodge a complaint with the UK Information Commissioner's Office (ICO):</p>
          <ul class="mt-2">
            <li>Website: <a href="https://ico.org.uk/make-a-complaint/" target="_blank">https://ico.org.uk/make-a-complaint/</a></li>
            <li>Phone: 0303 123 1113</li>
          </ul>
        </div>
        
        <h2>6. Cookies</h2>
        <p>We use essential cookies for:</p>
        <ul>
          <li>Session authentication (keeps you logged in)</li>
          <li>Security (prevents CSRF attacks)</li>
        </ul>
        
        <p>Third-party cookies may be set by:</p>
        <ul>
          <li>Stripe (payment processing)</li>
          <li>Cloudflare (security and performance)</li>
        </ul>
        
        <p>You can disable cookies in your browser settings, but this may affect Service functionality.</p>
        <p>See our <a href="/cookies">Cookie Policy</a> for full details.</p>
        
        <h2>7. Marketing Communications</h2>
        <p>With your consent, we may send promotional emails approximately once every two weeks featuring:</p>
        <ul>
          <li>New features and updates</li>
          <li>Special offers and discounts</li>
          <li>Tips for better product photography</li>
        </ul>
        
        <p>You can unsubscribe anytime by:</p>
        <ul>
          <li>Clicking "Unsubscribe" in any email</li>
          <li>Adjusting preferences in your account settings</li>
          <li>Emailing <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></li>
        </ul>
        
        <h2>8. Children's Privacy</h2>
        <p>The Service is not intended for users under 16 years old. We do not knowingly collect information from children. If you believe a child has created an account, contact us immediately for deletion.</p>
        
        <h2>9. Data Security</h2>
        <p>We protect your information through:</p>
        <ul>
          <li>Encrypted HTTPS connections</li>
          <li>Password hashing (bcrypt)</li>
          <li>Secure database access controls</li>
          <li>Regular security audits</li>
        </ul>
        <p>However, no internet transmission is 100% secure. You use the Service at your own risk.</p>
        
        <h2>10. Changes to This Policy</h2>
        <p>We may update this Privacy Policy periodically. Changes will be posted on this page with a revised "Last Updated" date. Continued use of the Service after changes constitutes acceptance.</p>
        
        <h2>11. Contact Us</h2>
        <div class="info-box">
          <p>For privacy questions or data requests:</p>
          <p class="mt-2"><strong>Email:</strong> <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
          <p><strong>Address:</strong> ShopShot Ltd, Burwash, East Sussex, England</p>
        </div>
      </div>
    </div>
  </main>
  
  ${LEGAL_FOOTER_HTML}
</body>
</html>`
}

export function getTermsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/terms">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${LEGAL_STYLES}
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>These Terms of Service ("Terms") govern your use of ShopShot ("Service") operated by ShopShot Ltd ("we," "us," or "our"), a company registered in England.</p>
        
        <div class="warning-box">
          <p><strong>By using the Service, you agree to these Terms. If you disagree, do not use the Service.</strong></p>
        </div>
        
        <h2>1. Service Description</h2>
        <p>ShopShot is an AI-powered platform that transforms product photographs into professional e-commerce images. You upload a photo, and our technology generates 10 professional variations optimized for online selling (using 10 credits - 1 credit per image).</p>
        
        <h2>2. Account Registration</h2>
        
        <h3>Eligibility:</h3>
        <ul>
          <li>You must be at least 16 years old</li>
          <li>You must provide accurate information</li>
          <li>One account per person</li>
        </ul>
        
        <h3>Account Security:</h3>
        <ul>
          <li>You are responsible for maintaining password confidentiality</li>
          <li>Notify us immediately of unauthorized access</li>
          <li>We are not liable for losses from compromised accounts</li>
        </ul>
        
        <h2>3. Credit System</h2>
        
        <h3>How Credits Work:</h3>
        <ul>
          <li><strong>1 credit = 1 generated image</strong></li>
          <li><strong>Standard Credits</strong> - Use our fast AI model (best for quick results)</li>
          <li><strong>Pro Credits</strong> - Use our premium AI model (best quality)</li>
          <li>A full product shoot generates 10 images and uses 10 credits</li>
          <li>Single image regeneration uses 1 credit</li>
        </ul>
        
        <h3>Credit Rules:</h3>
        <ul>
          <li>Credits are non-refundable once used</li>
          <li>Credits do not expire while your subscription is active</li>
          <li>Free trial credits expire after 30 days</li>
          <li>Unused credits are forfeited upon subscription cancellation</li>
        </ul>
        
        <h2>4. Subscriptions & Billing</h2>
        
        <h3>Subscription Plans:</h3>
        <ul>
          <li>Billed monthly via Stripe</li>
          <li><strong>Auto-renewal:</strong> Your subscription automatically renews each month unless cancelled</li>
          <li>You authorize recurring charges to your payment method</li>
        </ul>
        
        <h3>Cancellation:</h3>
        <ul>
          <li>Cancel anytime via your account settings or Stripe customer portal</li>
          <li>Cancellation takes effect at the end of the current billing period</li>
          <li>No partial refunds for unused time</li>
        </ul>
        
        <h3>Price Changes:</h3>
        <ul>
          <li>We may change pricing with 30 days' notice</li>
          <li>Existing subscribers keep current rate until next renewal after notice period</li>
        </ul>
        
        <h2>5. User Content & Copyright</h2>
        
        <h3>Your Warranties:</h3>
        <p>You represent and warrant that:</p>
        <ul>
          <li>✅ You own or have obtained all necessary rights to any images you upload</li>
          <li>✅ Your images do not infringe any copyright, trademark, or intellectual property rights</li>
          <li>✅ Your images do not violate any laws or third-party rights</li>
          <li>✅ You have permission to use any brands, logos, or products shown in photos</li>
        </ul>
        
        <h3>Ownership of Generated Images:</h3>
        <ul>
          <li>You retain ownership of your original uploaded photos</li>
          <li>You own the generated image variations for commercial use</li>
          <li>We retain the right to process and store images to provide the Service</li>
        </ul>
        
        <h3>Our Rights:</h3>
        <ul>
          <li>We may remove content that violates these Terms</li>
          <li>We may terminate accounts for repeated violations</li>
          <li>We reserve the right to use anonymized generation data to improve the Service (no personally identifiable images)</li>
        </ul>
        
        <h2>6. Prohibited Uses</h2>
        <p>You may NOT upload images containing:</p>
        
        <div class="danger-box">
          <ul>
            <li>❌ Illegal products (drugs, weapons, counterfeit goods)</li>
            <li>❌ Adult/sexual content (NSFW material)</li>
            <li>❌ Copyrighted material you don't own (stock photos, brand imagery without permission)</li>
            <li>❌ Offensive, defamatory, or hateful content</li>
            <li>❌ Content that violates any laws or regulations</li>
          </ul>
        </div>
        
        <h3>Enforcement:</h3>
        <ul>
          <li>First violation: Warning and content removal</li>
          <li>Repeat violations: Account suspension or permanent ban</li>
          <li>Illegal content: Reported to authorities</li>
        </ul>
        
        <h2>7. AI-Generated Content Disclaimer</h2>
        
        <div class="warning-box">
          <p class="font-semibold mb-2">Important Limitations:</p>
          <ul>
            <li>⚠️ AI-generated images are provided "AS-IS" without warranties</li>
            <li>⚠️ We do not guarantee outputs will be suitable for your commercial purposes</li>
            <li>⚠️ Generated images may occasionally resemble existing copyrighted works (AI limitation)</li>
            <li>⚠️ You are solely responsible for reviewing images before commercial use</li>
            <li>⚠️ We are not liable for business losses, reputational harm, or legal claims arising from generated content</li>
          </ul>
        </div>
        
        <h3>Your Responsibility:</h3>
        <ul>
          <li>Inspect all generated images before using in product listings</li>
          <li>Ensure outputs meet platform requirements (eBay, Amazon, Etsy guidelines)</li>
          <li>Verify images don't inadvertently violate third-party rights</li>
        </ul>
        
        <h2>8. Indemnification</h2>
        <p>You agree to indemnify and hold harmless ShopShot Ltd, its directors, employees, and partners from any claims, damages, losses, or expenses (including legal fees) arising from:</p>
        <ul>
          <li>Your uploaded content</li>
          <li>Your use of generated images</li>
          <li>Your violation of these Terms</li>
          <li>Your violation of any laws or third-party rights</li>
          <li>Copyright infringement claims related to your uploaded photos</li>
        </ul>
        
        <div class="info-box">
          <p><strong>Example:</strong> If Getty Images sues us because you uploaded their copyrighted photo, you agree to cover our legal costs and any settlement.</p>
        </div>
        
        <h2>9. Limitation of Liability</h2>
        <p>To the maximum extent permitted by law:</p>
        <ul>
          <li>We are NOT liable for indirect, incidental, or consequential damages</li>
          <li>Our total liability is limited to the amount you paid in the last 12 months (maximum £500)</li>
          <li>We are not responsible for third-party service outages (payment processors, AI providers, hosting)</li>
        </ul>
        
        <h3>Exceptions:</h3>
        <ul>
          <li>We do not limit liability for death/injury caused by negligence</li>
          <li>We do not limit liability for fraud or fraudulent misrepresentation</li>
        </ul>
        
        <h2>10. Service Availability</h2>
        
        <h3>No Guarantees:</h3>
        <ul>
          <li>We strive for 99% uptime but do not guarantee uninterrupted service</li>
          <li>Maintenance, updates, or third-party issues may cause downtime</li>
          <li>Force majeure events (natural disasters, government actions, infrastructure failures) excuse performance</li>
        </ul>
        
        <h3>Refunds for Outages:</h3>
        <ul>
          <li>Service outage >48 consecutive hours = pro-rata refund (see <a href="/refunds">Refund Policy</a>)</li>
        </ul>
        
        <h2>11. Refund Policy</h2>
        <p>See our full <a href="/refunds">Refund Policy</a>.</p>
        <p><strong>Summary:</strong></p>
        <ul>
          <li>No refunds except in case of prolonged service outage (>48 hours)</li>
          <li>Pro-rata refunds may apply for extended technical failures</li>
          <li>Chargebacks/disputes may result in account termination</li>
        </ul>
        
        <h2>12. Account Termination</h2>
        <p>We may terminate your account if:</p>
        <ul>
          <li>You violate these Terms</li>
          <li>You engage in fraudulent activity</li>
          <li>You abuse the Service (e.g., scraping, reverse engineering)</li>
          <li>Required by law</li>
        </ul>
        
        <h3>Upon Termination:</h3>
        <ul>
          <li>Your access is immediately revoked</li>
          <li>Unused credits are forfeited (no refunds)</li>
          <li>Your data will be deleted per our retention policy</li>
        </ul>
        
        <h2>13. Intellectual Property</h2>
        
        <h3>Our Trademarks:</h3>
        <ul>
          <li>"ShopShot" name, logo, and branding are owned by ShopShot Ltd</li>
          <li>You may not use our trademarks without written permission</li>
        </ul>
        
        <h3>Service Code:</h3>
        <ul>
          <li>The Service's underlying software is proprietary and protected by copyright</li>
        </ul>
        
        <h2>14. Dispute Resolution</h2>
        
        <h3>Governing Law:</h3>
        <p>These Terms are governed by the laws of England and Wales</p>
        
        <h3>Jurisdiction:</h3>
        <p>Any disputes shall be resolved in the courts of England and Wales</p>
        
        <h3>Informal Resolution:</h3>
        <p>Before filing a claim, contact us at <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a> to seek informal resolution</p>
        
        <h2>15. Severability</h2>
        <p>If any provision of these Terms is found unenforceable, the remaining provisions remain in full effect.</p>
        
        <h2>16. Changes to Terms</h2>
        <p>We may update these Terms at any time. Significant changes will be communicated via:</p>
        <ul>
          <li>Email notification</li>
          <li>Prominent notice on the Service</li>
        </ul>
        <p>Continued use after changes constitutes acceptance.</p>
        
        <h2>17. Contact</h2>
        <div class="info-box">
          <p>For questions about these Terms:</p>
          <p class="mt-2"><strong>Email:</strong> <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
          <p><strong>Address:</strong> ShopShot Ltd, Burwash, East Sussex, England</p>
        </div>
      </div>
    </div>
  </main>
  
  ${LEGAL_FOOTER_HTML}
</body>
</html>`
}

export function getRefundsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Policy - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/refunds">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${LEGAL_STYLES}
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Refund Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <div class="danger-box">
          <p class="font-semibold text-red-800">ShopShot Ltd operates a strict no-refund policy for digital products. Please read carefully before purchasing.</p>
        </div>
        
        <h2>1. No Refunds for Digital Goods</h2>
        <p><strong>All purchases are final.</strong></p>
        
        <p>Once credits are delivered to your account, they are non-refundable under any circumstances, including:</p>
        <ul>
          <li>❌ Change of mind</li>
          <li>❌ Unused credits</li>
          <li>❌ Dissatisfaction with generated images</li>
          <li>❌ Technical issues on your end (browser compatibility, internet connection)</li>
          <li>❌ Misunderstanding of how the Service works</li>
        </ul>
        
        <div class="info-box">
          <p class="font-semibold mb-2">Why No Refunds?</p>
          <ul>
            <li>Digital products are delivered instantly</li>
            <li>Credits can be used immediately</li>
            <li>Refund abuse is common in digital services</li>
          </ul>
        </div>
        
        <h2>2. Exception: Prolonged Service Outage</h2>
        <p>We will issue pro-rata refunds <strong>ONLY</strong> if:</p>
        <ul>
          <li>✅ The Service is completely unavailable for more than 48 consecutive hours</li>
          <li>✅ The outage is caused by our infrastructure (not third-party providers)</li>
          <li>✅ You request a refund within 7 days of service restoration</li>
        </ul>
        
        <h3>Pro-Rata Calculation:</h3>
        <p><code>Monthly subscription (30 days) x (Hours down / 720 hours)</code></p>
        <p><em>Example: 72-hour outage = 72/720 = 10% refund (£3.99 for Standard plan)</em></p>
        
        <h3>Excluded Outages:</h3>
        <ul>
          <li>Third-party service failures (Stripe, hosting providers, AI models)</li>
          <li>Scheduled maintenance (with advance notice)</li>
          <li>Force majeure events (natural disasters, government actions)</li>
        </ul>
        
        <h2>3. Free Trial</h2>
        <p>We offer <strong>15 free credits</strong> for new users to test the Service before purchasing.</p>
        
        <p>Use the free trial to:</p>
        <ul>
          <li>Test image quality</li>
          <li>Understand how credits work</li>
          <li>Ensure the Service meets your needs</li>
        </ul>
        
        <div class="warning-box">
          <p><strong>No refunds will be issued for:</strong></p>
          <ul>
            <li>Complaints that could have been identified during the free trial</li>
            <li>"I didn't know it worked this way" (free trial exists for this reason)</li>
          </ul>
        </div>
        
        <h2>4. Subscription Cancellation</h2>
        <p>You can cancel your subscription anytime, but:</p>
        <ul>
          <li>Cancellation takes effect at the end of the current billing period</li>
          <li>No refunds for partial months</li>
          <li>Unused credits are forfeited upon cancellation</li>
          <li><strong>No exceptions</strong></li>
        </ul>
        
        <h3>How to Cancel:</h3>
        <ul>
          <li>Log into your account > Account Settings > Manage Subscription</li>
          <li>Or access the Stripe customer portal (link in account page)</li>
        </ul>
        
        <h2>5. Chargebacks & Payment Disputes</h2>
        <div class="danger-box">
          <p><strong>Filing a chargeback instead of contacting support will result in:</strong></p>
          <ul>
            <li>Immediate account termination</li>
            <li>Permanent ban from the Service</li>
            <li>Debt collection for unpaid balances</li>
          </ul>
        </div>
        
        <h3>Proper Dispute Process:</h3>
        <ol>
          <li>Email <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a> with your concern</li>
          <li>We will investigate within 48 hours</li>
          <li>If a refund is warranted (per this policy), we will process it within 7-10 business days</li>
        </ol>
        
        <h2>6. Fraudulent Purchases</h2>
        <p>If we detect fraudulent activity:</p>
        <ul>
          <li>Transactions will be reversed</li>
          <li>Accounts will be permanently banned</li>
          <li>We will cooperate with law enforcement</li>
        </ul>
        
        <h2>7. Refund Processing Time</h2>
        <p>For the rare cases where refunds are issued (prolonged outage):</p>
        <ul>
          <li>Refunds processed within 7-10 business days</li>
          <li>Refunds issued to the original payment method</li>
          <li>You will receive email confirmation</li>
        </ul>
        
        <h2>8. EU Consumer Rights (14-Day Withdrawal)</h2>
        <p>Under UK/EU Consumer Contracts Regulations:</p>
        <p>You have a 14-day "cooling-off period" for online purchases. However:</p>
        
        <div class="success-box">
          <p>✅ <strong>By completing checkout, you explicitly agree to waive this right</strong> in exchange for immediate access to digital content (credits)</p>
        </div>
        
        <p>This waiver is presented clearly at checkout:</p>
        <p><em>☑️ "I agree to immediate access to credits and waive my 14-day cancellation right (Consumer Contracts Regulations 2013)"</em></p>
        
        <p>This waiver is legally enforceable because:</p>
        <ul>
          <li>Digital content is delivered immediately</li>
          <li>You explicitly consent at purchase</li>
          <li>Standard industry practice for SaaS/digital goods</li>
        </ul>
        
        <h2>9. Questions</h2>
        <p>If you have concerns about a purchase:</p>
        <ul>
          <li><strong>Email:</strong> <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></li>
          <li><strong>Response Time:</strong> Within 48 hours</li>
        </ul>
        
        <p>Be prepared to provide:</p>
        <ul>
          <li>Account email</li>
          <li>Transaction ID</li>
          <li>Detailed explanation of issue</li>
        </ul>
        
        <p>We will review each case, but please note: <strong>the no-refund policy stands</strong> unless service outage criteria are met.</p>
        
        <h2>10. Contact</h2>
        <div class="info-box">
          <p><strong>ShopShot Ltd</strong></p>
          <p>Burwash, East Sussex, England</p>
          <p><a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
        </div>
      </div>
    </div>
  </main>
  
  ${LEGAL_FOOTER_HTML}
</body>
</html>`
}

export function getCookiesPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cookie Policy - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/cookies">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${LEGAL_STYLES}
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>This Cookie Policy explains how ShopShot ("we," "us," or "our") uses cookies and similar technologies on www.shopshot.co.uk (the "Service").</p>
        
        <h2>1. What Are Cookies?</h2>
        <p>Cookies are small text files stored on your device when you visit websites. They help websites remember your preferences and improve user experience.</p>
        
        <h2>2. Cookies We Use</h2>
        
        <h3>Essential Cookies (Cannot Be Disabled)</h3>
        <p>These cookies are necessary for the Service to function:</p>
        
        <table>
          <thead>
            <tr>
              <th>Cookie Name</th>
              <th>Purpose</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>session</code></td>
              <td>Keeps you logged in</td>
              <td>30 days</td>
            </tr>
            <tr>
              <td><code>csrf_token</code></td>
              <td>Prevents security attacks</td>
              <td>Session</td>
            </tr>
          </tbody>
        </table>
        
        <div class="info-box">
          <p><strong>Why Essential:</strong></p>
          <ul>
            <li>Without these cookies, you cannot use your account</li>
            <li>They do not track personal information beyond authentication</li>
          </ul>
        </div>
        
        <h2>3. Third-Party Cookies</h2>
        <p>We use trusted partners who may set their own cookies:</p>
        
        <h3>Stripe (Payment Processing)</h3>
        <ul>
          <li><strong>Purpose:</strong> Fraud prevention, secure checkout</li>
          <li><strong>Data Collected:</strong> Payment method, billing address</li>
          <li><strong>Privacy Policy:</strong> <a href="https://stripe.com/privacy" target="_blank">https://stripe.com/privacy</a></li>
        </ul>
        
        <h3>Cloudflare (Security & Hosting)</h3>
        <ul>
          <li><strong>Purpose:</strong> DDoS protection, performance optimization</li>
          <li><strong>Data Collected:</strong> IP address, browser type</li>
          <li><strong>Privacy Policy:</strong> <a href="https://www.cloudflare.com/privacypolicy/" target="_blank">https://www.cloudflare.com/privacypolicy/</a></li>
        </ul>
        
        <h3>AI Processing (Backend Only)</h3>
        <ul>
          <li><strong>Purpose:</strong> AI image generation (server-side, no browser cookies)</li>
          <li><strong>Data Collected:</strong> Uploaded images (processed securely)</li>
          <li>Images are processed by third-party AI providers and not stored beyond the generation session</li>
        </ul>
        
        <div class="success-box">
          <p><strong>Note:</strong> We do NOT use analytics or advertising cookies. No behavioral tracking occurs on the Service.</p>
        </div>
        
        <h2>4. Managing Cookies</h2>
        
        <h3>How to Disable Cookies:</h3>
        
        <p><strong>Chrome:</strong></p>
        <ul>
          <li>Settings > Privacy and Security > Cookies</li>
          <li>Block third-party cookies or all cookies</li>
        </ul>
        
        <p><strong>Firefox:</strong></p>
        <ul>
          <li>Settings > Privacy & Security > Cookies</li>
          <li>Choose "Block cookies" or "Custom"</li>
        </ul>
        
        <p><strong>Safari:</strong></p>
        <ul>
          <li>Preferences > Privacy</li>
          <li>Enable "Block all cookies"</li>
        </ul>
        
        <div class="warning-box">
          <p><strong>Warning:</strong> Disabling essential cookies will prevent you from logging in and using the Service.</p>
        </div>
        
        <h2>5. Do Not Track (DNT)</h2>
        <p>We respect browser "Do Not Track" signals. However:</p>
        <ul>
          <li>Essential cookies are still required for functionality</li>
          <li>Third-party cookies (Stripe, Cloudflare) may not honor DNT</li>
        </ul>
        
        <h2>6. Cookie Consent</h2>
        <p>By using the Service, you consent to our use of essential cookies.</p>
        
        <p><strong>No consent required for:</strong></p>
        <ul>
          <li>Authentication cookies (strictly necessary)</li>
          <li>Security cookies (fraud prevention)</li>
        </ul>
        
        <p>If we add analytics cookies in the future:</p>
        <ul>
          <li>We will implement an opt-in consent banner</li>
          <li>You will be able to reject non-essential cookies</li>
        </ul>
        
        <h2>7. Changes to This Policy</h2>
        <p>We may update this Cookie Policy as our use of cookies changes. Updates will be posted on this page with a revised "Last Updated" date.</p>
        
        <h2>8. Contact</h2>
        <div class="info-box">
          <p>For cookie questions:</p>
          <p class="mt-2"><strong>Email:</strong> <a href="mailto:support@shopshot.co.uk">support@shopshot.co.uk</a></p>
          <p><strong>Address:</strong> ShopShot Ltd, Burwash, East Sussex, England</p>
        </div>
        
        <h2>9. Related Policies</h2>
        <ul>
          <li><a href="/privacy">Privacy Policy</a> - How we use your data</li>
          <li><a href="/terms">Terms of Service</a> - Rules for using the Service</li>
        </ul>
      </div>
    </div>
  </main>
  
  ${LEGAL_FOOTER_HTML}
</body>
</html>`
}
