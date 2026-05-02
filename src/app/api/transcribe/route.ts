import { NextResponse } from "next/server";
import { transcribeAudioInput } from "@/server/api/audio";

export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }

  try {
    const result = await transcribeAudioInput(audio);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
