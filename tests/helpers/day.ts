import type { DayResult } from "@/lib/attendance";

/** DayResult lengkap dengan nilai netral; uji cukup menimpa field yang relevan. */
export function makeDay(over: Partial<DayResult> = {}): DayResult {
  return {
    date: "2026-10-05", status: "HADIR", scheduled: true, offReason: null, scheduleName: null, scheduleStart: "08:00", scheduleEnd: "16:00",
    endsNextDay: false, shiftStartAt: null, shiftEndAt: null,
    checkInAt: null, checkOutAt: null, checkInTime: null, checkOutTime: null, checkInNextDay: false, checkOutNextDay: false,
    late: false, lateMinutes: 0, workedMinutes: 0, missingCheckout: false, incomplete: false, afterEndMinutes: 0,
    leaveType: null, leaveRequestId: null, dayPart: null,
    fractions: { present: 1, izin: 0, sakit: 0, cuti: 0, absent: 0, pending: 0 },
    explain: "", ...over,
  };
}
