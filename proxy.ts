import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextRequest, NextFetchEvent, NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

// The ecosystem connector authenticates with its own bearer tokens. Clerk must not look at those requests at all:
// it would try to read the Authorization header as a session token (and call out to verify it).
const isConnectorApi = (pathname: string) => pathname.startsWith('/api/connect/') || pathname === '/.well-known/ecosystem-connector.json';

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isConnectorApi(request.nextUrl.pathname)) return NextResponse.next();
  return clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  })(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)', // txt/xml: robots.txt, sitemap.xml, llms.txt must never wait on auth
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
