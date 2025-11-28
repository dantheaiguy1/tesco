// Info Page Templates (FAQ, About, Contact)

// Google Tag Manager + Google Analytics snippets
const GTM_HEAD = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-PNKMSPJN');</script>
<!-- End Google Tag Manager -->
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FJR6WVMLHE"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-FJR6WVMLHE');
</script>`;

const GTM_BODY = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PNKMSPJN"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

const FOOTER_HTML = `
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

export function getFaqPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FAQ - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/faq">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What is ShopShot?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "ShopShot uses advanced AI to transform your product photos into professional e-commerce images. Upload one photo and get 10 different professional variations including lifestyle shots, flat-lays, and hero images."
        }
      },
      {
        "@type": "Question",
        "name": "How do credits work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "1 credit = 1 generated image. A full product shoot creates 10 images and uses 10 credits. Standard Credits use our fast AI model (about 25 seconds for 10 images). Pro Credits use our premium AI model for the highest quality output (2-5 minutes)."
        }
      },
      {
        "@type": "Question",
        "name": "Do credits expire?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Subscription credits reset each billing cycle and don't roll over. Top-up credits don't expire as long as your account remains active."
        }
      },
      {
        "@type": "Question",
        "name": "Can I get a refund?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We offer 15 free credits to test the service before purchasing. Due to the instant delivery of digital credits and AI processing costs, all sales are final. No refunds are provided except in cases of extended service outages (48+ hours)."
        }
      },
      {
        "@type": "Question",
        "name": "How do I cancel my subscription?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "You can cancel anytime from your account settings. You'll keep access until the end of your billing period. No penalties or fees for canceling."
        }
      }
    ]
  }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${GTM_HEAD}
  <style>
    * { font-family: 'Inter', sans-serif; }
    .faq-item { border-bottom: 1px solid #E5E7EB; }
    .faq-question { cursor: pointer; }
    .faq-answer { display: none; }
    .faq-item.open .faq-answer { display: block; }
    .faq-item.open .faq-icon { transform: rotate(180deg); }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${GTM_BODY}
  <header class="bg-white border-b border-gray-200">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 text-xl font-bold text-gray-900">
        <span class="text-2xl">📸</span> ShopShot
      </a>
      <nav class="flex items-center gap-4">
        <a href="/contact" class="text-gray-600 hover:text-gray-900 text-sm">Contact</a>
        <a href="/app" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Open App</a>
      </nav>
    </div>
  </header>
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold text-gray-900 mb-2">Frequently Asked Questions</h1>
    <p class="text-gray-600 mb-8">Can't find what you're looking for? <a href="/contact" class="text-blue-600 hover:underline">Contact us</a></p>
    
    <section class="mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span class="text-2xl">🚀</span> Getting Started
      </h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">How does ShopShot work?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>ShopShot uses advanced AI to transform your product photos into professional e-commerce images. Simply upload a photo of your product, and our AI generates 10 different professional variations including studio shots, lifestyle images, close-ups, and more.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">What file formats can I upload?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>We accept JPG, PNG, and WebP images. For best results, use high-resolution photos with good lighting and a clean background.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">What's the maximum image size?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Maximum file size is 10MB. We recommend images at least 1000x1000 pixels for optimal results. Larger images may be automatically resized.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span class="text-2xl">💳</span> Credits & Billing
      </h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">What's the difference between Standard and Pro credits?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p><strong>1 credit = 1 generated image.</strong> A full product shoot creates 10 images and uses 10 credits.</p>
            <p class="mt-2"><strong>Standard Credits</strong> use our fast, reliable AI model. Generation takes about 25 seconds for all 10 images (10 Standard credits).</p>
            <p class="mt-2"><strong>Pro Credits</strong> use our premium AI model for the highest quality output. Generation takes 2-5 minutes but produces superior results (10 Pro credits).</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Do credits expire?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Subscription credits reset each billing cycle and don't roll over. Top-up credits don't expire as long as your account is active.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">How do I cancel my subscription?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Go to your <a href="/account" class="text-blue-600 hover:underline">Account page</a> and click "Manage Billing". You can cancel anytime, and you'll retain access until the end of your billing period.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Can I get a refund?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p><strong>No.</strong> All sales are final and no refunds are issued under any circumstances. We offer 15 free credits so you can test the service before purchasing. See our <a href="/refunds" class="text-blue-600 hover:underline">Refund Policy</a> for full details.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span class="text-2xl">🖼️</span> Image Quality
      </h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Why do some generated images look different from my product?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>AI generation is creative by nature. For best results: use clear, well-lit photos, show the product from a straightforward angle, avoid cluttered backgrounds, and use Pro mode for more accurate results.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Can I regenerate a single image?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Yes! Click the refresh icon on any generated image to regenerate just that variation. This costs 1 credit.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span class="text-2xl">👤</span> Account
      </h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">I forgot my password. How do I reset it?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Go to the <a href="/login" class="text-blue-600 hover:underline">login page</a> and click "Forgot password?". Enter your email and we'll send you a reset link.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">How do I delete my account?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Email <a href="mailto:support@shopshot.co.uk" class="text-blue-600 hover:underline">support@shopshot.co.uk</a> with your account email to request deletion. We'll process your request within 30 days.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span class="text-2xl">⚙️</span> Technical
      </h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">What browsers are supported?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>ShopShot works best on modern browsers: Chrome, Firefox, Safari, and Edge (latest versions).</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Is there a mobile app?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>Not yet, but our website is fully mobile-responsive. You can use ShopShot from any smartphone browser.</p>
          </div>
        </div>
        <div class="faq-item">
          <div class="faq-question flex justify-between items-center p-4 hover:bg-gray-50" onclick="toggleFaq(this)">
            <span class="font-medium text-gray-900">Do you have an API?</span>
            <span class="faq-icon transition-transform">▼</span>
          </div>
          <div class="faq-answer px-4 pb-4 text-gray-600">
            <p>API access is coming soon for high-volume users. <a href="/contact" class="text-blue-600 hover:underline">Contact us</a> if you're interested in early access.</p>
          </div>
        </div>
      </div>
    </section>
    
    <div class="bg-blue-50 rounded-xl p-6 text-center">
      <h3 class="font-bold text-gray-900 mb-2">Still have questions?</h3>
      <p class="text-gray-600 mb-4">We're here to help!</p>
      <a href="/contact" class="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700">Contact Support</a>
    </div>
  </main>
  
  ${FOOTER_HTML}
  
  <script>
    function toggleFaq(element) {
      const item = element.parentElement;
      item.classList.toggle('open');
    }
  </script>
</body>
</html>`
}

export function getAboutPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/about">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${GTM_HEAD}
  <style>* { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${GTM_BODY}
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
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="text-center mb-16">
      <h1 class="text-4xl font-bold text-gray-900 mb-4">About ShopShot</h1>
      <p class="text-xl text-gray-600 max-w-2xl mx-auto">Democratizing professional product photography with the power of AI</p>
    </div>
    
    <section class="mb-16">
      <div class="bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl p-8 text-white">
        <h2 class="text-2xl font-bold mb-4">🎯 Our Mission</h2>
        <p class="text-lg text-blue-100">
          Every online seller deserves stunning product photos, not just those who can afford professional photographers. ShopShot levels the playing field by giving small businesses access to AI-powered photography that rivals the big brands.
        </p>
      </div>
    </section>
    
    <section class="mb-16">
      <h2 class="text-2xl font-bold text-gray-900 mb-6">🔧 How It Works</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white rounded-xl p-6 border border-gray-200">
          <div class="text-3xl mb-4">📤</div>
          <h3 class="font-bold text-gray-900 mb-2">1. Upload</h3>
          <p class="text-gray-600">Take a photo of your product with your phone or camera. No fancy equipment needed.</p>
        </div>
        <div class="bg-white rounded-xl p-6 border border-gray-200">
          <div class="text-3xl mb-4">🤖</div>
          <h3 class="font-bold text-gray-900 mb-2">2. AI Magic</h3>
          <p class="text-gray-600">Our AI analyzes your product and generates 10 professional variations (uses 10 credits).</p>
        </div>
        <div class="bg-white rounded-xl p-6 border border-gray-200">
          <div class="text-3xl mb-4">🚀</div>
          <h3 class="font-bold text-gray-900 mb-2">3. Sell More</h3>
          <p class="text-gray-600">Download your images and use them on eBay, Etsy, Amazon, Shopify, or anywhere you sell.</p>
        </div>
      </div>
    </section>
    
    <section class="mb-16">
      <h2 class="text-2xl font-bold text-gray-900 mb-6">👥 Who We Built This For</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl p-6 border border-gray-200 flex gap-4">
          <div class="text-3xl">🏪</div>
          <div>
            <h3 class="font-bold text-gray-900 mb-1">Small Business Owners</h3>
            <p class="text-gray-600">Scaling your product line? Generate professional photos faster than ever.</p>
          </div>
        </div>
        <div class="bg-white rounded-xl p-6 border border-gray-200 flex gap-4">
          <div class="text-3xl">💼</div>
          <div>
            <h3 class="font-bold text-gray-900 mb-1">eBay & Etsy Sellers</h3>
            <p class="text-gray-600">Stand out from the competition with studio-quality images.</p>
          </div>
        </div>
        <div class="bg-white rounded-xl p-6 border border-gray-200 flex gap-4">
          <div class="text-3xl">📦</div>
          <div>
            <h3 class="font-bold text-gray-900 mb-1">Resellers & Thrifters</h3>
            <p class="text-gray-600">Turn thrift finds into premium listings with beautiful photos.</p>
          </div>
        </div>
        <div class="bg-white rounded-xl p-6 border border-gray-200 flex gap-4">
          <div class="text-3xl">🎨</div>
          <div>
            <h3 class="font-bold text-gray-900 mb-1">Creative Agencies</h3>
            <p class="text-gray-600">Speed up client work with AI-assisted product photography.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="mb-16">
      <h2 class="text-2xl font-bold text-gray-900 mb-6">🎯 Our Story</h2>
      <div class="bg-white rounded-xl p-8 border border-gray-200">
        <p class="text-gray-600 mb-4">
          ShopShot was built by entrepreneurs who understand the struggle. We saw small sellers spending hundreds on professional photography while competing against brands with unlimited budgets.
        </p>
        <p class="text-gray-600 mb-4">
          So we built something better: AI-powered product photography that levels the playing field. Now anyone can create stunning e-commerce images in seconds, not hours.
        </p>
        <p class="text-gray-600">
          Based in East Sussex, UK, we're committed to helping online sellers succeed with affordable, professional-quality imagery.
        </p>
      </div>
    </section>
    
    <section class="text-center bg-gray-900 rounded-2xl p-12">
      <h2 class="text-2xl font-bold text-white mb-4">Ready to transform your product photos?</h2>
      <p class="text-gray-400 mb-6">Start with 15 free credits. No credit card required.</p>
      <a href="/register" class="inline-block bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition">
        Get Started Free →
      </a>
    </section>
  </main>
  
  ${FOOTER_HTML}
</body>
</html>`
}

export function getContactPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact - ShopShot</title>
  <link rel="canonical" href="https://www.shopshot.co.uk/contact">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${GTM_HEAD}
  <style>* { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${GTM_BODY}
  <header class="bg-white border-b border-gray-200">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 text-xl font-bold text-gray-900">
        <span class="text-2xl">📸</span> ShopShot
      </a>
      <nav class="flex items-center gap-4">
        <a href="/faq" class="text-gray-600 hover:text-gray-900 text-sm">FAQ</a>
        <a href="/about" class="text-gray-600 hover:text-gray-900 text-sm">About</a>
        <a href="/app" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Open App</a>
      </nav>
    </div>
  </header>
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <div class="text-center mb-12">
      <h1 class="text-3xl font-bold text-gray-900 mb-4">Contact Us</h1>
      <p class="text-gray-600">Have a question? We're here to help!</p>
    </div>
    
    <div class="grid md:grid-cols-2 gap-8">
      <div class="bg-white rounded-xl border border-gray-200 p-8">
        <h2 class="text-xl font-bold text-gray-900 mb-6">Send us a message</h2>
        <form id="contact-form" onsubmit="handleSubmit(event)">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Name *</label>
            <input type="text" name="name" required class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Your name">
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Email *</label>
            <input type="email" name="email" required class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="you@example.com">
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            <select name="subject" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Select a topic...</option>
              <option value="General Question">General Question</option>
              <option value="Billing Issue">Billing Issue</option>
              <option value="Technical Problem">Technical Problem</option>
              <option value="Feature Request">Feature Request</option>
              <option value="Partnership">Partnership Inquiry</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2">Message *</label>
            <textarea name="message" required rows="5" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="How can we help?"></textarea>
          </div>
          <button type="submit" id="submit-btn" class="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50">
            Send Message
          </button>
          <div id="form-message" class="mt-4 text-center hidden"></div>
        </form>
      </div>
      
      <div class="space-y-6">
        <div class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex gap-4">
            <div class="text-2xl">📧</div>
            <div>
              <h3 class="font-bold text-gray-900 mb-1">Email Support</h3>
              <p class="text-gray-600 mb-2">For general inquiries and support</p>
              <a href="mailto:support@shopshot.co.uk" class="text-blue-600 hover:underline">support@shopshot.co.uk</a>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex gap-4">
            <div class="text-2xl">⏱️</div>
            <div>
              <h3 class="font-bold text-gray-900 mb-1">Response Time</h3>
              <p class="text-gray-600">We typically respond within <strong>24-48 hours</strong> on business days.</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex gap-4">
            <div class="text-2xl">❓</div>
            <div>
              <h3 class="font-bold text-gray-900 mb-1">Common Questions</h3>
              <p class="text-gray-600 mb-2">Check our FAQ for instant answers</p>
              <a href="/faq" class="text-blue-600 hover:underline">View FAQ →</a>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex gap-4">
            <div class="text-2xl">🏢</div>
            <div>
              <h3 class="font-bold text-gray-900 mb-1">Business Address</h3>
              <p class="text-gray-600">
                ShopShot Ltd<br>
                Burwash, East Sussex<br>
                United Kingdom
              </p>
            </div>
          </div>
        </div>
        
        <div class="bg-blue-50 rounded-xl p-6">
          <h3 class="font-bold text-gray-900 mb-2">💡 Quick Tips</h3>
          <ul class="text-gray-600 text-sm space-y-2">
            <li>• For billing issues, include your account email and transaction ID</li>
            <li>• For technical problems, describe what you expected vs what happened</li>
            <li>• Include screenshots if relevant</li>
          </ul>
        </div>
      </div>
    </div>
  </main>
  
  ${FOOTER_HTML}
  
  <script>
    async function handleSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const btn = document.getElementById('submit-btn');
      const msg = document.getElementById('form-message');
      
      btn.disabled = true;
      btn.textContent = 'Sending...';
      msg.classList.add('hidden');
      
      const data = {
        name: form.name.value,
        email: form.email.value,
        subject: form.subject.value,
        message: form.message.value
      };
      
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (result.success) {
          msg.textContent = '✅ Message sent! We will get back to you soon.';
          msg.className = 'mt-4 text-center text-green-600';
          form.reset();
        } else {
          msg.textContent = '❌ ' + (result.error || 'Failed to send. Please try again.');
          msg.className = 'mt-4 text-center text-red-600';
        }
      } catch (error) {
        msg.textContent = '❌ Network error. Please try again.';
        msg.className = 'mt-4 text-center text-red-600';
      }
      
      msg.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  </script>
</body>
</html>`
}
