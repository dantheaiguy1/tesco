// Legal Page Templates - Privacy, Terms, Refunds, Cookies

const LEGAL_FOOTER_HTML = `
  <footer class="bg-white border-t border-gray-200 mt-12">
    <div class="max-w-4xl mx-auto px-4 py-8">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
        <div>
          <h4 class="font-semibold text-gray-900 mb-3">Product</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li><a href="/" class="hover:text-gray-900">Home</a></li>
            <li><a href="/pricing" class="hover:text-gray-900">Pricing</a></li>
            <li><a href="/faq" class="hover:text-gray-900">FAQ</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-gray-900 mb-3">Company</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li><a href="/about" class="hover:text-gray-900">About</a></li>
            <li><a href="/contact" class="hover:text-gray-900">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-gray-900 mb-3">Legal</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li><a href="/privacy" class="hover:text-gray-900">Privacy Policy</a></li>
            <li><a href="/terms" class="hover:text-gray-900">Terms of Service</a></li>
            <li><a href="/refunds" class="hover:text-gray-900">Refund Policy</a></li>
            <li><a href="/cookies" class="hover:text-gray-900">Cookie Policy</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-gray-900 mb-3">Support</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li><a href="mailto:support@shopshot.ai" class="hover:text-gray-900">support@shopshot.ai</a></li>
            <li><a href="/contact" class="hover:text-gray-900">Contact Form</a></li>
          </ul>
        </div>
      </div>
      <div class="border-t border-gray-200 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <p class="text-sm text-gray-500">&copy; ${new Date().getFullYear()} ShopShot. All rights reserved.</p>
        <p class="text-sm text-gray-500">Built by Daniel David Peter Nichols | AI Academy</p>
      </div>
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

export function getPrivacyPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - ShopShot</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .legal-content h2 { margin-top: 2rem; margin-bottom: 1rem; }
    .legal-content p, .legal-content ul { margin-bottom: 1rem; }
    .legal-content ul { padding-left: 1.5rem; list-style-type: disc; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>ShopShot ("we," "our," or "us"), operated by Daniel David Peter Nichols, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered product photography service at shopshot.pages.dev.</p>
        
        <h2 class="text-xl font-bold text-gray-900">1. Information We Collect</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Account Information</h3>
        <ul>
          <li><strong>Email address</strong> - Used for account login, communication, and password recovery</li>
          <li><strong>Name</strong> - Used to personalize your experience</li>
          <li><strong>Password (hashed)</strong> - Securely stored using bcrypt hashing; we never store plain-text passwords</li>
          <li><strong>Google Account ID</strong> - If you sign in via Google OAuth, we store your Google ID to link your account</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Payment Information</h3>
        <ul>
          <li><strong>Stripe Customer ID</strong> - Links your account to Stripe for payment processing</li>
          <li><strong>Subscription details</strong> - Plan type, status, and billing dates</li>
          <li><strong>Note:</strong> We do NOT store credit card numbers, CVVs, or full card details. All payment data is processed and stored by Stripe.</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Product Images</h3>
        <ul>
          <li><strong>Uploaded images</strong> - Product photos you upload for AI processing</li>
          <li><strong>Generated images</strong> - AI-generated product photography variations</li>
          <li>Images are stored temporarily and automatically deleted after 90 days</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Technical Data</h3>
        <ul>
          <li><strong>IP address</strong> - For security, fraud prevention, and analytics</li>
          <li><strong>Browser type and version</strong> - For compatibility and debugging</li>
          <li><strong>Session cookies</strong> - Essential for maintaining your login state</li>
          <li><strong>Usage data</strong> - How you interact with our service (pages visited, features used)</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">2. How We Use Your Information</h2>
        <ul>
          <li><strong>Service Delivery:</strong> Processing your images through our AI system to generate product photography</li>
          <li><strong>Account Management:</strong> Creating and managing your account, authenticating logins</li>
          <li><strong>Billing:</strong> Processing payments, managing subscriptions, issuing invoices</li>
          <li><strong>Communication:</strong> Sending transactional emails (password resets, receipts, important updates)</li>
          <li><strong>AI Generation:</strong> Sending your product images to Google Vertex AI for processing</li>
          <li><strong>Analytics:</strong> Understanding usage patterns to improve our service</li>
          <li><strong>Security:</strong> Detecting and preventing fraud, abuse, or unauthorized access</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">3. Third-Party Service Providers</h2>
        <p>We share data with the following trusted providers who process data on our behalf:</p>
        
        <div class="bg-gray-50 rounded-lg p-4 my-4">
          <h4 class="font-semibold text-gray-900 mb-2">Stripe (Payment Processing)</h4>
          <p class="text-sm">Processes all payments securely. See <a href="https://stripe.com/privacy" class="text-blue-600 hover:underline" target="_blank">Stripe Privacy Policy</a></p>
        </div>
        
        <div class="bg-gray-50 rounded-lg p-4 my-4">
          <h4 class="font-semibold text-gray-900 mb-2">Google Vertex AI (Image Generation)</h4>
          <p class="text-sm">Powers our AI image generation using Gemini models. Images are processed for generation only and not used to train Google's models. See <a href="https://cloud.google.com/terms/cloud-privacy-notice" class="text-blue-600 hover:underline" target="_blank">Google Cloud Privacy Notice</a></p>
        </div>
        
        <div class="bg-gray-50 rounded-lg p-4 my-4">
          <h4 class="font-semibold text-gray-900 mb-2">Resend (Email Delivery)</h4>
          <p class="text-sm">Delivers transactional emails. See <a href="https://resend.com/legal/privacy-policy" class="text-blue-600 hover:underline" target="_blank">Resend Privacy Policy</a></p>
        </div>
        
        <div class="bg-gray-50 rounded-lg p-4 my-4">
          <h4 class="font-semibold text-gray-900 mb-2">Cloudflare (Hosting & CDN)</h4>
          <p class="text-sm">Hosts our application and provides security services. See <a href="https://www.cloudflare.com/privacypolicy/" class="text-blue-600 hover:underline" target="_blank">Cloudflare Privacy Policy</a></p>
        </div>
        
        <h2 class="text-xl font-bold text-gray-900">4. Your Rights (GDPR/CCPA)</h2>
        <p>Depending on your location, you may have the following rights:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your personal data</li>
          <li><strong>Rectification:</strong> Correct inaccurate or incomplete data</li>
          <li><strong>Deletion:</strong> Request deletion of your personal data ("Right to be Forgotten")</li>
          <li><strong>Portability:</strong> Receive your data in a machine-readable format</li>
          <li><strong>Objection:</strong> Object to processing of your personal data</li>
          <li><strong>Withdraw Consent:</strong> Withdraw previously given consent at any time</li>
        </ul>
        <p>To exercise these rights, email us at <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a>. We will respond within 30 days.</p>
        
        <h2 class="text-xl font-bold text-gray-900">5. Data Retention</h2>
        <ul>
          <li><strong>Product Images:</strong> Automatically deleted 90 days after generation</li>
          <li><strong>Account Data:</strong> Retained until you close your account or request deletion</li>
          <li><strong>Transaction Records:</strong> Retained for 7 years for legal/tax compliance</li>
          <li><strong>Session Data:</strong> Expires after 7 days of inactivity</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">6. Cookie Policy</h2>
        <p>We use the following types of cookies:</p>
        <ul>
          <li><strong>Essential Cookies:</strong> Required for login/session management. Cannot be disabled.</li>
          <li><strong>Analytics Cookies:</strong> Help us understand how you use ShopShot (currently none implemented)</li>
        </ul>
        <p>For detailed information, see our <a href="/cookies" class="text-blue-600 hover:underline">Cookie Policy</a>.</p>
        
        <h2 class="text-xl font-bold text-gray-900">7. Data Security</h2>
        <p>We implement industry-standard security measures:</p>
        <ul>
          <li>All data transmitted over HTTPS (TLS 1.3)</li>
          <li>Passwords hashed using bcrypt with salt</li>
          <li>Database encrypted at rest (Cloudflare D1)</li>
          <li>Regular security audits and updates</li>
          <li>Access controls and authentication for all systems</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">8. International Transfers</h2>
        <p>Your data may be processed in the United States, European Union, and other regions where our service providers operate. We ensure appropriate safeguards are in place for international transfers.</p>
        
        <h2 class="text-xl font-bold text-gray-900">9. Children's Privacy</h2>
        <p>ShopShot is not intended for children under 16. We do not knowingly collect data from children. If you believe a child has provided us with personal data, please contact us immediately.</p>
        
        <h2 class="text-xl font-bold text-gray-900">10. Changes to This Policy</h2>
        <p>We may update this Privacy Policy periodically. We will notify you of significant changes via email or a prominent notice on our website. Continued use after changes constitutes acceptance.</p>
        
        <h2 class="text-xl font-bold text-gray-900">11. Contact Us</h2>
        <div class="bg-blue-50 rounded-lg p-4">
          <p><strong>Data Controller:</strong> Daniel David Peter Nichols</p>
          <p><strong>Email:</strong> <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a></p>
          <p><strong>Location:</strong> East Sussex, United Kingdom</p>
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
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .legal-content h2 { margin-top: 2rem; margin-bottom: 1rem; }
    .legal-content p, .legal-content ul, .legal-content ol { margin-bottom: 1rem; }
    .legal-content ul, .legal-content ol { padding-left: 1.5rem; }
    .legal-content ul { list-style-type: disc; }
    .legal-content ol { list-style-type: decimal; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>Welcome to ShopShot. By using our service, you agree to these Terms of Service ("Terms"). Please read them carefully.</p>
        
        <h2 class="text-xl font-bold text-gray-900">1. Service Description</h2>
        <p>ShopShot is an AI-powered product photography service that transforms single product photos into professional e-commerce images. We use Google Vertex AI (Gemini models) to generate 10 professional image variations from your uploaded product photos.</p>
        
        <h2 class="text-xl font-bold text-gray-900">2. Eligibility</h2>
        <ul>
          <li>You must be at least 16 years old to use ShopShot</li>
          <li>You must provide accurate account information</li>
          <li>You are responsible for maintaining the security of your account credentials</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">3. User Obligations</h2>
        <p>By using ShopShot, you agree to:</p>
        <ul>
          <li>Provide accurate and complete information</li>
          <li>Keep your account credentials secure</li>
          <li>Use the service only for lawful purposes</li>
          <li>Not share your account with others</li>
          <li>Not attempt to circumvent any security measures</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">4. Prohibited Uses</h2>
        <p class="font-semibold text-gray-900">You may NOT use ShopShot to generate images of:</p>
        <ul>
          <li><strong>Adult/NSFW Content:</strong> Pornography, sexually explicit materials</li>
          <li><strong>Weapons:</strong> Firearms, explosives, ammunition, weapon parts</li>
          <li><strong>Drugs:</strong> Illegal drugs, controlled substances, drug paraphernalia</li>
          <li><strong>Counterfeit Goods:</strong> Fake branded products, trademark infringement</li>
          <li><strong>Harmful Products:</strong> Products designed to harm, deceive, or defraud</li>
          <li><strong>Illegal Items:</strong> Any products illegal to sell in your jurisdiction</li>
          <li><strong>Regulated Goods:</strong> Tobacco, alcohol (without proper licensing)</li>
          <li><strong>Hate/Violence:</strong> Products promoting hate, discrimination, or violence</li>
        </ul>
        <p class="bg-red-50 p-4 rounded-lg text-red-800 mt-4">Violation of these terms will result in immediate account termination without refund. We may report illegal activity to law enforcement.</p>
        
        <h2 class="text-xl font-bold text-gray-900">5. Credit System</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Credit Types</h3>
        <ul>
          <li><strong>Standard Credits:</strong> 1 credit per image, uses fast AI model (Gemini Flash)</li>
          <li><strong>Pro Credits:</strong> 1 credit per image, uses premium AI model (Gemini Pro)</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Credit Rules</h3>
        <ul>
          <li>Generating 10 images costs 10 credits (1 per variation)</li>
          <li>Regenerating a single image costs 1 credit</li>
          <li>Subscription credits reset each billing cycle (do not roll over)</li>
          <li>Top-up (one-time purchase) credits do not expire while your account is active</li>
          <li>Credits are non-transferable between accounts</li>
          <li>Credits cannot be converted to cash or transferred</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">6. Subscription Terms</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Billing</h3>
        <ul>
          <li>Subscriptions are billed monthly in advance</li>
          <li>Prices are in USD unless otherwise stated</li>
          <li>You authorize us to charge your payment method on each billing date</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Cancellation</h3>
        <ul>
          <li>Cancel anytime from your Account page or via Stripe billing portal</li>
          <li>Access continues until the end of your current billing period</li>
          <li>No partial refunds for unused time within a billing period</li>
          <li>Unused subscription credits expire at the end of each billing period</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Price Changes</h3>
        <ul>
          <li>We may change prices with 30 days notice</li>
          <li>Price changes take effect at the start of your next billing cycle</li>
          <li>Continued use after price change constitutes acceptance</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">7. Intellectual Property</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Your Content</h3>
        <ul>
          <li>You retain ownership of product photos you upload</li>
          <li>You grant us a license to process your images for the purpose of providing our service</li>
          <li>You own the generated images and can use them commercially</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Our Content</h3>
        <ul>
          <li>ShopShot branding, logos, and UI are our intellectual property</li>
          <li>You may not copy, modify, or redistribute our software</li>
          <li>The AI models remain the property of Google/Alphabet Inc.</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">8. Liability Limitations</h2>
        <p class="bg-yellow-50 p-4 rounded-lg text-yellow-800">SHOPSHOT IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.</p>
        <ul class="mt-4">
          <li>We do not guarantee AI-generated images will meet your expectations</li>
          <li>We are not liable for business losses resulting from service use or unavailability</li>
          <li>Our maximum liability is limited to the amount you paid in the past 12 months</li>
          <li>We are not responsible for third-party actions or services</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">9. Indemnification</h2>
        <p>You agree to indemnify and hold harmless ShopShot, its owner, employees, and agents from any claims, damages, or expenses (including legal fees) arising from:</p>
        <ul>
          <li>Your use of the service</li>
          <li>Your violation of these Terms</li>
          <li>Your violation of any third-party rights</li>
          <li>Content you upload or generate</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">10. Termination</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">By You</h3>
        <ul>
          <li>You may close your account at any time by emailing support@shopshot.ai</li>
          <li>Cancel any active subscription before closing your account</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">By Us</h3>
        <ul>
          <li>We may suspend or terminate your account for violating these Terms</li>
          <li>We may terminate accounts inactive for more than 12 months</li>
          <li>We may discontinue the service with 30 days notice</li>
        </ul>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Effect of Termination</h3>
        <ul>
          <li>Unused credits are forfeited upon account termination</li>
          <li>Your images will be deleted per our retention policy</li>
          <li>Sections 4, 7-11 survive termination</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">11. Dispute Resolution</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Informal Resolution</h3>
        <p>Before filing any formal dispute, contact us at support@shopshot.ai. We will attempt to resolve the issue within 30 days.</p>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Arbitration</h3>
        <p>If informal resolution fails, disputes will be resolved through binding arbitration under the rules of the Chartered Institute of Arbitrators (CIArb), except for claims eligible for small claims court.</p>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Governing Law</h3>
        <p>These Terms are governed by the laws of <strong>England and Wales</strong>. Any litigation must be brought in courts located in England.</p>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Class Action Waiver</h3>
        <p>You agree to resolve disputes on an individual basis. You waive the right to participate in class actions or representative proceedings.</p>
        
        <h2 class="text-xl font-bold text-gray-900">12. Changes to Terms</h2>
        <p>We may modify these Terms at any time. Changes become effective 30 days after posting. Continued use after changes constitutes acceptance. Material changes will be notified via email.</p>
        
        <h2 class="text-xl font-bold text-gray-900">13. General Provisions</h2>
        <ul>
          <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and ShopShot</li>
          <li><strong>Severability:</strong> If any provision is found invalid, other provisions remain in effect</li>
          <li><strong>No Waiver:</strong> Failure to enforce a right does not waive that right</li>
          <li><strong>Assignment:</strong> You may not assign these Terms; we may assign them freely</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">14. Contact</h2>
        <div class="bg-blue-50 rounded-lg p-4">
          <p><strong>ShopShot</strong></p>
          <p>Operated by: Daniel David Peter Nichols</p>
          <p>Email: <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a></p>
          <p>Location: East Sussex, United Kingdom</p>
        </div>
        
        <p class="mt-6 text-sm text-gray-500">By using ShopShot, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.</p>
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
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .legal-content h2 { margin-top: 2rem; margin-bottom: 1rem; }
    .legal-content p, .legal-content ul { margin-bottom: 1rem; }
    .legal-content ul { padding-left: 1.5rem; list-style-type: disc; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Refund Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p class="text-blue-800"><strong>Summary:</strong> ShopShot provides digital goods. While refunds are generally not available for used credits, we offer refunds for new subscriptions within 48 hours if no credits have been used.</p>
        </div>
        
        <h2 class="text-xl font-bold text-gray-900">1. Digital Goods Nature</h2>
        <p>ShopShot provides digital AI-generated images. Once credits are used and images are generated, the service has been delivered. Due to the nature of digital goods, we generally cannot offer refunds for used credits.</p>
        
        <h2 class="text-xl font-bold text-gray-900">2. Refund Eligibility</h2>
        
        <div class="bg-green-50 rounded-lg p-4 my-4">
          <h3 class="font-semibold text-green-800 mb-2">✅ Eligible for Refund</h3>
          <ul class="text-green-800">
            <li><strong>New Subscription (48-hour window):</strong> Full refund if requested within 48 hours of your first subscription payment AND no credits have been used</li>
            <li><strong>Extended Service Outage:</strong> Pro-rata refund if our service is unavailable for more than 24 consecutive hours during your billing period</li>
            <li><strong>Accidental Duplicate Charges:</strong> Full refund of duplicate transactions</li>
            <li><strong>Unauthorized Charges:</strong> Full refund after investigation confirms unauthorized use</li>
          </ul>
        </div>
        
        <div class="bg-red-50 rounded-lg p-4 my-4">
          <h3 class="font-semibold text-red-800 mb-2">❌ NOT Eligible for Refund</h3>
          <ul class="text-red-800">
            <li>Credits that have already been used to generate images</li>
            <li>Subscription cancellations after the 48-hour window</li>
            <li>Unused credits at the end of a billing period</li>
            <li>Dissatisfaction with AI-generated image quality (AI results vary)</li>
            <li>Change of mind after purchase</li>
            <li>Account termination due to Terms of Service violation</li>
          </ul>
        </div>
        
        <h2 class="text-xl font-bold text-gray-900">3. How to Request a Refund</h2>
        <ol class="list-decimal pl-6">
          <li class="mb-2"><strong>Email us</strong> at <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a></li>
          <li class="mb-2"><strong>Include:</strong>
            <ul class="mt-1">
              <li>Your account email</li>
              <li>Transaction ID or Stripe payment ID</li>
              <li>Date of purchase</li>
              <li>Reason for refund request</li>
            </ul>
          </li>
          <li class="mb-2">We will review your request within <strong>3 business days</strong></li>
        </ol>
        
        <h2 class="text-xl font-bold text-gray-900">4. Refund Process</h2>
        <ul>
          <li><strong>Processing Time:</strong> Approved refunds are processed within 7-10 business days</li>
          <li><strong>Method:</strong> Refunds are issued to the original payment method</li>
          <li><strong>Bank Processing:</strong> Your bank may take additional time to reflect the refund (up to 5-7 days)</li>
          <li><strong>Currency:</strong> Refunds are issued in the original transaction currency</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">5. Technical Failure Compensation</h2>
        <p>If you experience a technical failure that wastes credits:</p>
        <ul>
          <li>Contact us within 24 hours of the issue</li>
          <li>Provide details of what happened (error messages, screenshots if possible)</li>
          <li>We will investigate and credit your account if the failure was on our end</li>
        </ul>
        <p>Note: This applies to system failures, not AI quality issues (AI generation is inherently variable).</p>
        
        <h2 class="text-xl font-bold text-gray-900">6. Subscription Cancellation</h2>
        <ul>
          <li>You can cancel your subscription anytime from your Account page</li>
          <li>Access continues until the end of your current billing period</li>
          <li>No partial refunds for unused days within a billing period</li>
          <li>Unused subscription credits expire at the end of each billing cycle</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">7. Top-Up Credit Purchases</h2>
        <ul>
          <li>One-time credit purchases are non-refundable once used</li>
          <li>Unused top-up credits do not expire while your account is active</li>
          <li>Top-up credits are forfeited if your account is terminated for Terms violation</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">8. Chargebacks</h2>
        <p>If you file a chargeback with your bank instead of contacting us:</p>
        <ul>
          <li>Your account will be immediately suspended pending investigation</li>
          <li>If the chargeback is found to be fraudulent, your account will be permanently banned</li>
          <li>We encourage you to contact us first to resolve any issues</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">9. Consumer Rights</h2>
        <p>This policy does not affect your statutory consumer rights under applicable law, including the Consumer Rights Act 2015 (UK) or EU Consumer Rights Directive.</p>
        
        <h2 class="text-xl font-bold text-gray-900">10. Contact Us</h2>
        <div class="bg-blue-50 rounded-lg p-4">
          <p>For refund requests or questions about this policy:</p>
          <p class="mt-2"><strong>Email:</strong> <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a></p>
          <p><strong>Response Time:</strong> Within 24-48 business hours</p>
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
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .legal-content h2 { margin-top: 2rem; margin-bottom: 1rem; }
    .legal-content p, .legal-content ul { margin-bottom: 1rem; }
    .legal-content ul { padding-left: 1.5rem; list-style-type: disc; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${LEGAL_HEADER_HTML}
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-xl border border-gray-200 p-8 md:p-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
      <p class="text-gray-500 mb-8">Last Updated: November 28, 2025</p>
      
      <div class="legal-content text-gray-600">
        <p>This Cookie Policy explains how ShopShot uses cookies and similar technologies when you visit our website at shopshot.pages.dev.</p>
        
        <h2 class="text-xl font-bold text-gray-900">1. What Are Cookies?</h2>
        <p>Cookies are small text files stored on your device (computer, tablet, or mobile) when you visit a website. They help the website remember your preferences and improve your experience.</p>
        
        <h2 class="text-xl font-bold text-gray-900">2. Cookies We Use</h2>
        
        <h3 class="font-semibold text-gray-900 mt-6 mb-4">Essential Cookies (Required)</h3>
        <p>These cookies are necessary for the website to function. You cannot disable them.</p>
        
        <div class="overflow-x-auto">
          <table class="w-full border-collapse bg-gray-50 rounded-lg overflow-hidden my-4">
            <thead>
              <tr class="bg-gray-100">
                <th class="text-left p-3 font-semibold text-gray-900">Cookie Name</th>
                <th class="text-left p-3 font-semibold text-gray-900">Purpose</th>
                <th class="text-left p-3 font-semibold text-gray-900">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-gray-200">
                <td class="p-3 font-mono text-sm">session_token</td>
                <td class="p-3">Maintains your login session</td>
                <td class="p-3">7 days</td>
              </tr>
              <tr class="border-t border-gray-200">
                <td class="p-3 font-mono text-sm">__cf_bm</td>
                <td class="p-3">Cloudflare bot management</td>
                <td class="p-3">30 minutes</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <h3 class="font-semibold text-gray-900 mt-6 mb-4">Analytics Cookies (Optional)</h3>
        <p>We currently do not use third-party analytics cookies. If we add analytics in the future, we will update this policy and request your consent.</p>
        
        <div class="bg-green-50 border border-green-200 rounded-lg p-4 my-4">
          <p class="text-green-800"><strong>Current Status:</strong> ShopShot does not use Google Analytics, Facebook Pixel, or any third-party tracking cookies.</p>
        </div>
        
        <h3 class="font-semibold text-gray-900 mt-6 mb-4">Third-Party Cookies</h3>
        <p>Some third-party services we use may set their own cookies:</p>
        
        <div class="overflow-x-auto">
          <table class="w-full border-collapse bg-gray-50 rounded-lg overflow-hidden my-4">
            <thead>
              <tr class="bg-gray-100">
                <th class="text-left p-3 font-semibold text-gray-900">Service</th>
                <th class="text-left p-3 font-semibold text-gray-900">Purpose</th>
                <th class="text-left p-3 font-semibold text-gray-900">More Info</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-gray-200">
                <td class="p-3">Stripe</td>
                <td class="p-3">Payment processing, fraud prevention</td>
                <td class="p-3"><a href="https://stripe.com/cookies-policy/legal" class="text-blue-600 hover:underline" target="_blank">Stripe Cookies</a></td>
              </tr>
              <tr class="border-t border-gray-200">
                <td class="p-3">Google OAuth</td>
                <td class="p-3">Login authentication (if you use Google Sign-In)</td>
                <td class="p-3"><a href="https://policies.google.com/technologies/cookies" class="text-blue-600 hover:underline" target="_blank">Google Cookies</a></td>
              </tr>
              <tr class="border-t border-gray-200">
                <td class="p-3">Cloudflare</td>
                <td class="p-3">Security and performance</td>
                <td class="p-3"><a href="https://www.cloudflare.com/cookie-policy/" class="text-blue-600 hover:underline" target="_blank">Cloudflare Cookies</a></td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <h2 class="text-xl font-bold text-gray-900">3. How to Manage Cookies</h2>
        
        <h3 class="font-semibold text-gray-900 mt-4 mb-2">Browser Settings</h3>
        <p>You can control cookies through your browser settings:</p>
        <ul>
          <li><a href="https://support.google.com/chrome/answer/95647" class="text-blue-600 hover:underline" target="_blank">Google Chrome</a></li>
          <li><a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" class="text-blue-600 hover:underline" target="_blank">Mozilla Firefox</a></li>
          <li><a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac" class="text-blue-600 hover:underline" target="_blank">Safari</a></li>
          <li><a href="https://support.microsoft.com/en-us/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" class="text-blue-600 hover:underline" target="_blank">Microsoft Edge</a></li>
        </ul>
        
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 my-4">
          <p class="text-yellow-800"><strong>Warning:</strong> Blocking essential cookies will prevent you from logging in and using ShopShot.</p>
        </div>
        
        <h2 class="text-xl font-bold text-gray-900">4. Do Not Track</h2>
        <p>Some browsers offer a "Do Not Track" (DNT) feature. Since we do not currently use tracking cookies, our response to DNT signals does not affect functionality.</p>
        
        <h2 class="text-xl font-bold text-gray-900">5. Updates to This Policy</h2>
        <p>We may update this Cookie Policy to reflect changes in our practices or for legal reasons. We will post any changes on this page with an updated "Last Updated" date.</p>
        
        <h2 class="text-xl font-bold text-gray-900">6. Related Policies</h2>
        <ul>
          <li><a href="/privacy" class="text-blue-600 hover:underline">Privacy Policy</a> - How we collect and use your data</li>
          <li><a href="/terms" class="text-blue-600 hover:underline">Terms of Service</a> - Rules for using ShopShot</li>
        </ul>
        
        <h2 class="text-xl font-bold text-gray-900">7. Contact Us</h2>
        <div class="bg-blue-50 rounded-lg p-4">
          <p>If you have questions about our use of cookies:</p>
          <p class="mt-2"><strong>Email:</strong> <a href="mailto:support@shopshot.ai" class="text-blue-600 hover:underline">support@shopshot.ai</a></p>
        </div>
      </div>
    </div>
  </main>
  
  ${LEGAL_FOOTER_HTML}
</body>
</html>`
}
