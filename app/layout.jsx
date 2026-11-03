import '../src/styles.css';

export const metadata = { title: 'PRM — 생각의 흐름을 기억하다', description: '생각을 이어가는 공간' };

export default function RootLayout({ children }) {
  return <html lang="ko"><body>{children}</body></html>;
}
