CHIPAFRIMARKET — USD MASTER + AFRICAN LOCAL CURRENCIES

WHAT THIS BUILD DOES
- Product prices are entered by the admin in USD.
- Storefront includes a country selector for African markets.
- The selected country determines the display currency (e.g. Botswana BWP, Nigeria NGN, South Africa ZAR).
- USD reference exchange rates are fetched from open.er-api.com. If the rate service is unavailable, the storefront falls back to USD.
- Product photos are uploaded from the admin portal into Supabase Storage.
- Supabase stores products and order requests.

IMPORTANT RATE NOTE
These are indicative reference exchange rates, not guaranteed bank, card, cash-transfer or payment-settlement rates. The rate service is external and availability/terms can change. Do not use the displayed conversion as a final payment quote without checking your payment provider.

SETUP ON YOUR PHONE
1. Create a Supabase project at https://supabase.com.
2. In Supabase, open SQL Editor, paste all of supabase-schema.sql, and run it.
3. Open Project Settings > API. Copy the Project URL and anon/public key (or publishable key).
4. Open config.js in GitHub and replace YOUR_SUPABASE_PROJECT_URL and YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY. Never use a service_role/secret key in frontend code.
5. In Supabase, open Authentication > Users and create your admin login.
6. Copy that user's UUID. In SQL Editor run:
   insert into public.user_roles(user_id,is_admin) values('PASTE-ADMIN-USER-UUID-HERE',true);
7. Upload all files in this folder to the root of your GitHub repository.
8. In GitHub, open Settings > Pages. Choose Deploy from a branch, select main and /(root), then Save.
9. Open the published Pages URL. Open /admin.html, sign in, and add products with prices in USD.
10. Test a few country selections and order requests before announcing the store.

COUNTRY/CURRENCY COVERAGE
This starter includes the African country list and commonly used ISO currency codes. Some markets use shared regional currencies (XOF/XAF); Zimbabwe is configured to show USD. Availability of payment and delivery services differs by country, so only enable checkout for countries you can actually serve.

SECURITY / PRODUCTION CHECKLIST
- The checkout currently submits an order request, not a payment.
- Browser-side prices and totals can be manipulated. Before taking real payments, create a Supabase Edge Function or trusted backend that fetches product prices from the database and calculates discounts/totals server-side.
- Add anti-spam protection, order validation, delivery charges, tax/customs rules, and a payment provider that supports your target countries.
- Confirm the 50% discount and free-shipping promotion terms and margins before launch.
- Do not publish secret keys. The anon/publishable key is designed for frontend use with correct Row Level Security policies.

FILES
index.html / styles.css — storefront
admin.html / admin.css / admin.js — admin portal
app.js — storefront logic
country-currency.js — African country/currency list
config.js — Supabase settings and master currency
supabase-schema.sql — database and storage setup
