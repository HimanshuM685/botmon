import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/",
  publicRoutes: ["/", "/privacy"],
});

export const config = {
  // API routes check the session themselves and answer 401 JSON.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
