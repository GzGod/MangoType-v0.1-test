import { NextResponse } from "next/server";
import { authConfigState } from "@/lib/auth";

export async function GET() {
  const ready = authConfigState.hasAuthSecret && authConfigState.hasTwitterProvider;
  return NextResponse.json(
    {
      ready,
      hasAuthSecret: authConfigState.hasAuthSecret,
      hasTwitterProvider: authConfigState.hasTwitterProvider
    },
    { status: 200 }
  );
}

