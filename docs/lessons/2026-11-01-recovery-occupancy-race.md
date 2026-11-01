# Recovery root occupancy race

The first repair rechecked whether a recovery directory was empty at the end of preparation. A capture created during the final directory iterator close still escaped that boolean check, so a root without an authenticated prior binding could be accepted as empty.

For future filesystem observations, pin the directory identity and change metadata before reading and compare it after the iterator is closed; test changes during the final observation as well as before it. The caller must still revalidate before publication. These checks detect observed changes; they are not protection against arbitrary same-account commands.
