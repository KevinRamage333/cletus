-- Store only the age eligibility attestation version and timestamp; do not collect date of birth.
ALTER TABLE "User"
  ADD COLUMN "ageAttestationVersion" TEXT,
  ADD COLUMN "ageAttestedAt" TIMESTAMP(3);
