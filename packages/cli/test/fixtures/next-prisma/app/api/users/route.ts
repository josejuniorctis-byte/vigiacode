import { NextResponse } from 'next/server';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: string;
  nickname: string;
}

export async function GET() {
  return NextResponse.json([]);
}

export async function POST() {
  return NextResponse.json({ ok: true });
}
