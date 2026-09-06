"use client";
import {
  ImmersiveGeneration,
  type ImmersiveGenerationProps,
} from "./shittim-immersive/immersive-generation";
export function GenerationPage(props: ImmersiveGenerationProps) {
  return <ImmersiveGeneration {...props} />;
}
