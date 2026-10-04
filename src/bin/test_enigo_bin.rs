use enigo::{Enigo, Mouse, Keyboard, Settings, Direction, Coordinate};

fn main() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();
    enigo.move_mouse(10, 10, Coordinate::Abs).unwrap();
    enigo.button(enigo::Button::Left, Direction::Click).unwrap();
    enigo.text("Hello").unwrap();
}