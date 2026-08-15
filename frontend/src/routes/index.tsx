import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "../components/lp/Landing";

export const Route = createFileRoute("/")({ component: Landing });
