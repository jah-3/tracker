# PROJECT-NI-NOAH

## Run locally

1. Run [supabase-inventory.sql](./supabase-inventory.sql) in the Supabase SQL Editor. It sets up the products, vehicle locations, and shipments tables used by Inventory Stocks, Fleet Tracking, and package tracking.
2. On Windows PowerShell, start the static app with `npm.cmd start`.
3. Open [http://localhost:3000/login.html](http://localhost:3000/login.html).

Keep the terminal running while using the app locally. The app uses Supabase for authentication and inventory data; the Express/MySQL API is not required for the browser app. You can also use VS Code Live Server, as the browser app connects directly to Supabase.

## Accounts

Sign-up and sign-in use Supabase Auth. The browser client settings are in `supabase.js`. In the Supabase dashboard, enable email/password authentication and add `http://localhost:3000/**` and `http://localhost:5502/**` to the allowed redirect URLs if email confirmation is enabled.

Run the complete [supabase-inventory.sql](./supabase-inventory.sql) in the Supabase SQL Editor. It creates and updates the tables, assigns roles to existing accounts, and installs automatic role assignment: the verified developer email `justinregaspi11@gmail.com` gets `admin`, new accounts at [register.html](./register.html) get `supplier`, and signups in [driver.html](./driver.html) get `driver`. Other accounts cannot choose admin; existing non-developer admins are changed to suppliers by the migration. This replaces the earlier customer portal role setup.

Suppliers sign in or register at [supplier.html](./supplier.html), then land on their separate [supplier-dashboard.html](./supplier-dashboard.html) to register incoming packages, track assigned vehicles and delivery ETAs, and submit product requests for admin approval. Admins assign vehicles and suppliers to packages in Package Tracking and review product requests on Supplier Orders. Drivers sign in or register at [driver.html](./driver.html), then land on their separate [driver-dashboard.html](./driver-dashboard.html); the administrator assigns their account to a vehicle, after which drivers can view assigned packages, share GPS, and update package status. To change the developer email, update the matching email in both role-assignment statements in the SQL file before running it.

## Deploy publicly with Netlify

1. Run [supabase-inventory.sql](./supabase-inventory.sql) in the Supabase SQL Editor. This creates the products, vehicle locations, and shipments tables, role-based row policies, and a stock adjustment function.
2. Push the project to a GitHub repository. Keep `.env` out of GitHub; it contains local settings and is not needed by the static Netlify site.
3. In Netlify, choose **Add new site → Import an existing project**, connect GitHub, and select this repository. Netlify uses [netlify.toml](./netlify.toml); the publish directory is the project root and no build command is required.
4. Deploy and copy the Netlify URL. In Supabase **Authentication → URL Configuration**, set the Site URL to that URL and add `https://YOUR-SITE.netlify.app/**` to the Redirect URLs.
5. Sign in with verified `justinregaspi11@gmail.com` for administrator access. Suppliers register at `register.html`; drivers register through the Driver Portal.

Supabase row-level security enforces the portal boundaries in the database: administrators manage inventory, fleet, shipments, and supplier requests; drivers can read only vehicles assigned to their driver account and packages on those vehicles, and can update delivery status and ETA; suppliers can register packages, read only their own shipments and product requests, and submit requests for administrator review. Driver and supplier dashboard pages also verify the signed-in role before loading account data. Existing products in local MySQL are not copied automatically; export and import them into Supabase if you need to keep them.

## Vehicle cargo and live location

Create packages in Package Tracking and enter the quantity and destination address. The database automatically assigns the nearest available truck that has an assigned driver and GPS coordinates; unassigned packages are retried when a driver shares a location, a truck becomes available, or a package changes. You can still choose a truck manually. On the driver's phone, open [driver.html](./driver.html), sign in, and open the driver dashboard. Tap **Share Live GPS** and allow location access. Driver GPS, delivery status, vehicle assignments, and ETA updates appear on the administrator's Fleet Tracking and Package Tracking pages through Supabase Realtime, with a 30-second refresh fallback. The driver dashboard and supplier portal also refresh assignments and shipment status through Realtime, with a 30-second fallback. Keep the driver dashboard open during delivery. Location sharing is not background tracking; it requires the dashboard to remain open, an internet connection, and browser location permission.

The driver dashboard shows the assigned truck plate, driver name, status, scheduled delivery, destination, and ETA. Drivers can submit delivery proof photos when marking a package delivered, report delays or vehicle problems to the administrator, and calculate an optimized stop order and road route using OSRM. The administrator Fleet map and supplier map also show road-route lines from each truck's latest shared GPS location through its active assigned delivery stops; the lines refresh with live shipment/vehicle updates. The route starts at the truck rather than a warehouse because warehouse records do not currently provide geocoded origins. Route suggestions are road-routing estimates, not AI or live-traffic predictions. Run the full Supabase SQL setup to create the protected proof storage bucket, reports table, and schedule/proof fields.

## Package tracking

Open **View Shipments** on the dashboard to create packages with a tracking number, destination address, quantity, and delivery status. Assign a vehicle to a package; multiple packages can be assigned to one vehicle. Destination lookup uses OpenStreetMap Nominatim and route estimates use the public OSRM routing service. These services receive the package destination and driver GPS coordinates; estimates are approximate and require internet access.