/** name → full character name the server + team.sh match on; avatar → asset dir. */
export interface Persona {
  name: string;
  label: string;
  avatar: string;
}

export const PERSONAS: Persona[] = [
  { name: "Leonardo", label: "Leo", avatar: "leonardo" },
  { name: "Raphael", label: "Raph", avatar: "raphael" },
  { name: "Donatello", label: "Donnie", avatar: "donatello" },
  { name: "Michelangelo", label: "Mikey", avatar: "michelangelo" },
  { name: "Splinter", label: "Splinter", avatar: "splinter" },
  { name: "Shredder", label: "Shredder", avatar: "shredder" },
  { name: "Karai", label: "Karai", avatar: "karai" },
];

export function personaAvatarSrc(persona: Persona): string {
  return `avatars/tmnt/${persona.avatar}/idle.png`;
}

export function characterAvatarSrc(character: string | null | undefined): string {
  return `avatars/tmnt/${(character ?? "default").toLowerCase()}/idle.png`;
}
