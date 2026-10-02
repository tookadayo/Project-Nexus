export type MemberEligibility = "ELIGIBLE" | "SCREENING_PENDING" | "GUEST" | "UNKNOWN";
export type MemberObservation = {
  screening_pending: boolean;
  is_guest: boolean;
  screening_observed_at: Date | string | null;
  guest_observed_at: Date | string | null;
};
export function memberEligibility(member: MemberObservation): MemberEligibility {
  if (member.guest_observed_at && member.is_guest) return "GUEST";
  if (member.screening_observed_at && member.screening_pending) return "SCREENING_PENDING";
  if (!member.screening_observed_at || !member.guest_observed_at) return "UNKNOWN";
  return "ELIGIBLE";
}
