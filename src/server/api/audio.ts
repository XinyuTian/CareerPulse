import { AiBuilderApiClient } from "@/server/api/client";

const client = new AiBuilderApiClient();

/** Default `en` avoids auto-detect choosing the wrong language (e.g. zh) for English speech. */
export async function transcribeAudioInput(file: File, language = "en") {
  const formData = new FormData();
  formData.set("audio_file", file);
  formData.set("language", language);

  return client.transcribeAudio(formData);
}
