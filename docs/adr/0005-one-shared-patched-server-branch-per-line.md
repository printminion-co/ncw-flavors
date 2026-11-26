# One shared patched server branch per stable line

All flavors are built from the same `ionos-dev-v<nn>` branch; they differ only in apps, configuration and themes. Per-flavor server branches would multiply the rebase work by the number of flavors and make a release non-uniform. The cost is that a server change applies to every flavor and has to be gated by configuration if only one needs it. Lines are sequential: the live line gets new patches, the next line's candidate is regenerated from it, and the old line is frozen at cutover.
