"Hi" app icon set — put these in the app's public/icons/ folder.

icon-1024.png            App Store / TestFlight / Capacitor iOS (no transparency; iOS rounds the corners)
icon-512.png, icon-192.png   PWA "any" icons (rounded bubble with tail, transparent background)
maskable-512.png, maskable-192.png   PWA maskable (full colour, "Hi" inside the safe zone)
apple-touch-icon.png     iPhone "Add to Home Screen" (180x180)
android-foreground-432.png  Android adaptive icon foreground (background colour #1E7F93)
favicon.svg, favicon-32.png, favicon-64.png   Browser tab
bubble.svg, ios.svg       Editable vector sources

manifest.webmanifest "icons":
[
  {"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},
  {"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},
  {"src":"/icons/maskable-192.png","sizes":"192x192","type":"image/png","purpose":"maskable"},
  {"src":"/icons/maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}
]
"theme_color": "#1E7F93", "background_color": "#1E7F93"

index.html <head>:
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">

Colours: navy #1E7F93, teal #54B5C6, cream #1E7F93, white #FFFFFF. Lettering: Pacifico (OFL).

Colours: bubble #1E7F93 (teal blue), lettering #F2EFE6 (alabaster), dot #252C48 (navy).
