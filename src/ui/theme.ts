// Map-pin palette: ink on paper, a tomato pin color, a sea-teal for routes.
export const colors = {
  paper: '#F4F5F7',
  card: '#FFFFFF',
  ink: '#1D2230',
  sub: '#5E6676',
  line: '#E1E4EA',
  pin: '#E2574C',
  route: '#2F7A7E',
};

export const font = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.ink },
  h2: { fontSize: 17, fontWeight: '700' as const, color: colors.ink },
  body: { fontSize: 15, color: colors.ink, lineHeight: 22 },
  small: { fontSize: 13, color: colors.sub },
};

export const personColors = ['#E2574C', '#3C6FD8'];
