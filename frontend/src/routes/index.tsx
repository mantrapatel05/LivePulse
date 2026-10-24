import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Landing } from "../components/lp/Landing";
import { recordLandingHit } from "../lib/api";
import { captureReferralFromUrl } from "../lib/referral";

function LandingRoute() {
  useEffect(() => {
    const pid = captureReferralFromUrl();
    if (pid) recordLandingHit(pid);
  }, []);
  return <Landing />;
}

export const Route = createFileRoute("/")({ component: LandingRoute });
