require("dotenv").config();

// Keep dashboard auth tests offline and independent of any Supabase project.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;
process.env.SUPABASE_JWT_SECRET = "livepulse-jest-only-secret";
