# Candidate proof validation window

The first fix verified the staged proof and each artifact in sequence. A fixture changed the proof key after its read but while a later artifact was being checked; the validation still returned success. The resulting installation could have an invalid proof.

For a staged generation, retain the identity and change metadata of each file already read, then compare those observations again after all related files have been validated. Test mutations both before the first read and between reads. Such checks detect observed changes and do not claim protection against arbitrary commands running as the same user.
