/** Konstanta & tipe Obrolan internal (dipakai server dan klien). Rancangan: docs/OBROLAN.md. */

export const CHAT_ROOM_KINDS = ["DIRECT", "CHANNEL", "SUBJECT"] as const;
export type ChatRoomKindValue = (typeof CHAT_ROOM_KINDS)[number];
export const CHAT_SUBJECT_TYPES = ["ASSIGNMENT_LETTER", "TRAINING_PROJECT", "TRAINING_TASK"] as const;
export type ChatSubjectTypeValue = (typeof CHAT_SUBJECT_TYPES)[number];
export const CHAT_NOTIFY_MODES = ["ALL", "MENTIONS", "NONE"] as const;
export type ChatNotifyModeValue = (typeof CHAT_NOTIFY_MODES)[number];

export const CHAT_SUBJECT_LABEL: Record<ChatSubjectTypeValue, string> = {
  ASSIGNMENT_LETTER: "Surat Tugas", TRAINING_PROJECT: "Proyek Training", TRAINING_TASK: "Tugas Training",
};

export const CHAT_LIMITS = {
  /** Panjang isi pesan (karakter, setelah dirapikan). */
  maxBody: 4000,
  /** Sunting hanya dalam jendela ini sejak dikirim. */
  editWindowMinutes: 15,
  maxMentions: 10,
  maxRefs: 3,
  /** Batas kirim per pengguna per menit (pembatas laju). */
  sendPerMinute: 30,
  /** Membuat japri baru (per pengguna per menit). */
  newDirectPerMinute: 10,
  pageSize: 50,
  /** Jeda minimum antar push untuk ruang yang sama ke penerima yang sama (kecuali disebut). */
  pushGapSeconds: 60,
  /** Penerima yang baru saja melihat ruang tidak diberi push. */
  presenceSeconds: 20,
  /** Aliran SSE: batas per pengguna, umur, detak, periode periksa sesi. */
  streamsPerUser: 3,
  streamMaxSeconds: 600,
  streamTickMs: 2000,
  streamHeartbeatTicks: 12,
  streamSessionCheckTicks: 30,
  streamAccessRefreshTicks: 15,
} as const;

/** Rujukan penugasan pada pesan. */
export interface ChatRef { type: ChatSubjectTypeValue; id: string }

/** Rujukan setelah diselesaikan untuk SATU pembaca: yang tidak berhak hanya melihat penanda "tidak ada akses". */
export interface ChatRefCardDto {
  type: ChatSubjectTypeValue; id: string; accessible: boolean;
  /** Mis. nomor surat / judul tugas / nama proyek. Kosong bila tidak berhak. */
  title: string | null; subtitle: string | null; href: string | null;
}

export interface ChatMessageDto {
  id: string; seq: number; senderId: string; senderName: string; kind: "TEXT" | "SYSTEM";
  /** null = dihapus / dibersihkan retensi (lihat `deleted` / `purged`). */
  body: string | null; deleted: boolean; purged: boolean; hiddenByModerator: boolean;
  mine: boolean; edited: boolean; createdAt: string;
  replyTo: { id: string; senderName: string; snippet: string } | null;
  refs: ChatRefCardDto[];
  mentionedMe: boolean;
}

export interface ChatRoomDto {
  id: string; kind: ChatRoomKindValue; title: string; subtitle: string | null;
  subject: { type: ChatSubjectTypeValue; id: string; href: string | null } | null;
  lastSeq: number; rev: number; lastMessageAt: string | null;
  preview: { senderName: string; text: string } | null;
  unread: number; mentionUnread: number;
  notifyMode: ChatNotifyModeValue; mutedUntil: string | null;
  canPost: boolean; archived: boolean;
  /** Direktur membuka japri milik orang lain (baca-saja, tercatat di Audit Log). */
  auditView: boolean;
}

export interface ChatDirectoryEntry { userId: string; name: string; position: string | null; division: string | null }
export interface ChatSyncDto { rooms: { id: string; lastSeq: number; rev: number; unread: number }[]; totalUnread: number }
