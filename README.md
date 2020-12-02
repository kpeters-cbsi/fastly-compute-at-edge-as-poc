# Fastly Compute@Edge POC

When finished, this will take a SpaceX mission ID and provide the two-line oribital elements (TLEs) for each payload delivered by that mission.

This project consumes the SpaceX API at https://api.spacex.land/graphql/ and the N2YO satellite tracking API at https://www.n2yo.com/api/. It retrieves the NORAD ID for a given payload from SpaceX, and the TLEs for that payload from N2YO.
